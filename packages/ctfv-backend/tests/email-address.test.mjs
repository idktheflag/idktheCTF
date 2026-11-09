import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
test("oversized email addresses are never truncated into another recovery or invitation recipient", async () => {
  const db = createDatabase();
  const email = 'a'.repeat(241)+'@example.test';
  assert.equal(email.length,254);
  db.sqlite.prepare("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('p','P',?,'unused',1)").run(email);
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified,isAdmin) VALUES ('admin','Admin','a@example.test','unused',1,1)");
  const secret = 'email-address-test-only-secret';
  let sent=0;
  const env = { DATABASE:db,AUTH_SECRET:secret,APP_URL:'https://ctf.example.test',EMAIL:{ send:async()=>{sent++;} } };
  const admin = await sign({ userId:'admin',isAdmin:true,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60 },secret);
  for (const [path,authorization,status] of [['/api/users/auth/password-reset/request',undefined,200],['/api/event/invitations',`Bearer ${admin}`,400]]) {
    const response = await app.request(path,{ method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify({email:email+'extra'}) },env);
    assert.equal(response.status,status);
    assert.equal(sent,0,path);
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM password_reset_tokens').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM registration_invitations').get().n,0);
  const valid = await app.request('/api/users/auth/password-reset/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})},env);
  assert.equal(valid.status,200);
  assert.equal(sent,1);
  db.sqlite.close();
});
