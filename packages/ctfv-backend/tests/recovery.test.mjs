import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";

const app = await loadWorker();
const secret = "test-only-auth-secret-with-at-least-32-characters";
const verificationRequest = async (userId = "p", email = "p@example.test") => {
  const token = await sign({ userId, isAdmin: false, emailVerified: false, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  return { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ email }) };
};
test('concurrent verification resends reserve one delivery slot',async()=>{
  const db=createDatabase();db.sqlite.exec("INSERT INTO user(id,name,email,password) VALUES ('p','Player','p@example.test','unused')");
  let release;let started;let deliveries=0;
  const gate=new Promise(resolve=>{release=resolve;});const sending=new Promise(resolve=>{started=resolve;});
  const env={DATABASE:db,AUTH_SECRET:secret,APP_URL:'https://ctf.example.test',EMAIL:{send:async()=>{deliveries++;if(deliveries===1){started();await gate;}}}};
  const send=async()=>app.request('/api/users/auth/send-verify-email',await verificationRequest(),env);
  const first=send();await sending;
  let second;
  try{second=await send();}finally{release();await first;}
  assert.equal(second.status,429);
  assert.equal(deliveries,1);
  db.sqlite.close();
});
test('failed verification delivery releases its reserved resend cooldown',async()=>{
  const db=createDatabase();db.sqlite.exec("INSERT INTO user(id,name,email,password) VALUES ('p','Player','p@example.test','unused')");
  const response=await app.request('/api/users/auth/send-verify-email',await verificationRequest(),{DATABASE:db,AUTH_SECRET:secret,APP_URL:'https://ctf.example.test',EMAIL:{send:async()=>{throw new Error('Delivery unavailable');}}});
  assert.equal(response.status,503);
  assert.equal(db.sqlite.prepare("SELECT lastVerificationEmailSent FROM user WHERE id='p'").get().lastVerificationEmailSent,null);
  db.sqlite.close();
});
test('verification database failures are server errors rather than invalid-link responses',async()=>{
  const token=await sign({id:'player',purpose:'email-verification',authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const response=await app.request(`/api/users/auth/verify-email?token=${token}`,{}, {AUTH_SECRET:secret,DATABASE:{prepare(){throw new Error('Database unavailable');}}});
  assert.equal(response.status,500);
  assert.doesNotMatch((await response.json()).error,/invalid|expired/i);
});

test('invalid, expired and consumed reset links do not start password-update transactions',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('p','P','p@example.test','original',1)");
  const token='c'.repeat(64);
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
  const batch=db.batch.bind(db);
  let writes=0;
  db.batch=async(statements)=>{writes++;return batch(statements);};
  for(const state of ['missing','expired','used']){
    db.sqlite.exec('DELETE FROM password_reset_tokens');
    if(state!=='missing') db.sqlite.prepare("INSERT INTO password_reset_tokens(token_hash,user_id,expires_at,used_at) VALUES (?,'p',?,?)").run(hash,state==='expired'?1:Date.now()+60000,state==='used'?Date.now():null);
    const response=await app.request('/api/users/auth/password-reset/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,password:'new-password-12345'})},{DATABASE:db,AUTH_SECRET:secret});
    assert.equal(response.status,400);
    assert.equal(writes,0,state);
  }
  assert.equal(db.sqlite.prepare("SELECT password FROM user WHERE id='p'").get().password,'original');
  db.sqlite.close();
});

test("password recovery revokes an existing authenticated session", async () => {
  const db = createDatabase();
  db.sqlite.prepare("INSERT INTO user (id, name, email, password, emailVerified) VALUES (?, ?, ?, ?, 1)").run("player", "player", "player@example.test", "unused-old-hash");
  const token = await sign({ userId: "player", isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  const env = { DATABASE: db, AUTH_SECRET: secret, EMAIL: { send: async () => {} } };
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await app.request("/api/teams/me", { headers }, env)).status, 200);
  const resetToken = "a".repeat(64);
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resetToken))).toString("hex");
  db.sqlite.prepare("INSERT INTO password_reset_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hash, "player", Date.now() + 60000);
  const reset = await app.request("/api/users/auth/password-reset/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resetToken, password: "new-test-password-123" }) }, env);
  assert.equal(reset.status, 200, await reset.text());
  assert.equal((await app.request("/api/teams/me", { headers }, env)).status, 401);
  assert.equal((await app.request("/api/challenges/leaderboard", { headers }, env)).status, 401);
  const login = await app.request("/api/users/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "player@example.test", password: "new-test-password-123" }) }, env);
  assert.equal(login.status, 200);
  const fresh = await login.json();
  assert.equal((await app.request("/api/teams/me", { headers: { Authorization: `Bearer ${fresh.token}` } }, env)).status, 200);
  db.sqlite.close();
});

test("migration permits unverified accounts to replace legacy verification links", () => {
  const db = createDatabase((file, sqlite) => {
    if (file === "0010_auth_version.sql") sqlite.prepare("INSERT INTO user (id,name,email,password,lastVerificationEmailSent) VALUES ('legacy','legacy','legacy@example.test','unused',?)").run(Date.now());
  });
  assert.equal(db.sqlite.prepare("SELECT lastVerificationEmailSent FROM user WHERE id='legacy'").get().lastVerificationEmailSent, null);
  db.sqlite.close();
});

test("recovery during verification delivery cannot restore the invalid link cooldown", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password) VALUES ('player','player','player@example.test','unused')");
  const resetToken = "b".repeat(64);
  const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(resetToken))).toString("hex");
  db.sqlite.prepare("INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES (?,'player',?)").run(hash, Date.now()+60000);
  let oldLink;
  const env = { DATABASE: db, AUTH_SECRET: secret, APP_URL: "https://ctf.example.test", EMAIL_FROM: "no-reply@example.test", EMAIL: { send: async (message) => {
    oldLink = new URL(message.text.match(/https:\/\/\S+/)[0]);
    const reset = await app.request("/api/users/auth/password-reset/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: resetToken, password: "new-test-password-123" }) }, env);
    assert.equal(reset.status, 200);
  } } };
  const response = await app.request("/api/users/auth/send-verify-email", await verificationRequest("player", "player@example.test"), env);
  assert.equal(response.status, 200);
  assert.equal(db.sqlite.prepare("SELECT lastVerificationEmailSent FROM user WHERE id='player'").get().lastVerificationEmailSent, null);
  assert.equal((await app.request(`/api/users/auth/verify-email?${oldLink.searchParams}`, {}, env)).status, 400);
  db.sqlite.close();
});

test("email verification link can establish a session only once", async () => {
  const db = createDatabase();
  db.sqlite.prepare("INSERT INTO user (id, name, email, password) VALUES (?, ?, ?, ?)").run("player", "player", "player@example.test", "unused-hash");
  const messages = [];
  const env = { DATABASE: db, AUTH_SECRET: secret, APP_URL: "https://ctf.example.test", EMAIL_FROM: "no-reply@example.test", EMAIL: { send: async (message) => messages.push(message) } };
  const sent = await app.request("https://ctf.example.test/api/users/auth/send-verify-email", await verificationRequest("player", "player@example.test"), env);
  assert.equal(sent.status, 200, await sent.text());
  const verification = new URL(messages[0].text.match(/https:\/\/\S+/)[0]);
  const path = `/api/users/auth/verify-email?${verification.searchParams}`;
  assert.equal((await app.request(path, {}, env)).status, 200);
  assert.equal((await app.request(path, {}, env)).status, 400);
  db.sqlite.close();
});

test("verification resend requires a session and only sends to that session's account", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password) VALUES ('p','Player','p@example.test','unused'),('q','Other','q@example.test','unused')");
  let recipient;
  const env = { DATABASE: db, AUTH_SECRET: secret, APP_URL: "https://ctf.example.test", EMAIL: { send: async (message) => { recipient = message.to; } } };
  const anonymous = await app.request("/api/users/auth/send-verify-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "q@example.test" }) }, env);
  assert.equal(anonymous.status, 401);
  const ownRequest = await verificationRequest("p", "q@example.test");
  const response = await app.request("/api/users/auth/send-verify-email", ownRequest, env);
  assert.equal(response.status, 200);
  assert.equal(recipient, "p@example.test");
  assert.equal(db.sqlite.prepare("SELECT lastVerificationEmailSent FROM user WHERE id='q'").get().lastVerificationEmailSent, null);
  db.sqlite.close();
});
