import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";
import { sign } from "hono/jwt";

const compiled = await build({
  entryPoints: [new URL("../src/middlewares/auth.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { authMiddleware } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const secret = "test-only-auth-secret-with-at-least-32-characters";
const app = new Hono();
app.onError((_, c) => c.json({ error: "Server unavailable" }, 500));
app.use("*", authMiddleware);
app.get("/", (c) => c.json({ userId: c.get("jwtPayload").userId }));
const env = {
  AUTH_SECRET: secret,
  DATABASE: { prepare: () => ({ bind: () => ({ first: async () => ({ is_banned: 0, isAdmin: 0, emailVerified: 1, auth_version: 0 }) }) }) },
};
const claims = { userId: "participant", isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 60 };

test("valid HS256 participant session reaches the protected route", async () => {
  const token = await sign(claims, secret, "HS256");
  const response = await app.request("/", { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { userId: "participant" });
});

test("session signed with an unexpected algorithm is rejected", async () => {
  const token = await sign(claims, secret, "HS512");
  const response = await app.request("/", { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(response.status, 401);
});

test("expired participant session is rejected", async () => {
  const token = await sign({ ...claims, exp: 1 }, secret, "HS256");
  const response = await app.request("/", { headers: { Authorization: `Bearer ${token}` } }, env);
  assert.equal(response.status, 401);
});

test("database failures do not masquerade as expired sessions", async () => {
  const token = await sign(claims, secret, "HS256");
  const unavailable = { ...env, DATABASE: { prepare: () => { throw new Error("Database unavailable"); } } };
  const response = await app.request("/", { headers: { Authorization: `Bearer ${token}` } }, unavailable);
  assert.equal(response.status, 500);
});

test("valid unverified accounts receive verification-required instead of session-expired", async () => {
  const token = await sign({ ...claims, emailVerified: false }, secret, "HS256");
  const unverified = { ...env, DATABASE: { prepare: () => ({ bind: () => ({ first: async () => ({ is_banned: 0, isAdmin: 0, emailVerified: 0, auth_version: 0 }) }) }) } };
  const response = await app.request("/", { headers: { Authorization: `Bearer ${token}` } }, unverified);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "EMAIL_NOT_VERIFIED");
});
test('optional scoreboard authentication does not disguise database outages as expired sessions',async()=>{
  const {loadWorker}=await import('./helpers.mjs');
  const worker=await loadWorker();
  const token=await sign({userId:'player',isAdmin:false,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  for(const path of ['/api/challenges/leaderboard','/api/challenges/scoreboard-history']){
    const response=await worker.request(path,{headers:{Authorization:`Bearer ${token}`}},{AUTH_SECRET:secret,DATABASE:{prepare(){throw new Error('Database unavailable');}}});
    assert.equal(response.status,500,path);
  }
});
test('valid unverified sessions may browse public scores without gaining private-scoreboard privileges',async()=>{
  const {createDatabase,loadWorker}=await import('./helpers.mjs');
  const worker=await loadWorker();const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('pending','Pending','p@example.test','unused',1,0)");
  const token=await sign({userId:'pending',isAdmin:true,emailVerified:false,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const headers={Authorization:`Bearer ${token}`};const bindings={AUTH_SECRET:secret,DATABASE:db};
  for(const path of ['/api/challenges/leaderboard','/api/challenges/scoreboard-history']) assert.equal((await worker.request(path,{headers},bindings)).status,200,path);
  db.sqlite.exec('UPDATE event_settings SET scoreboard_public=0');
  for(const path of ['/api/challenges/leaderboard','/api/challenges/scoreboard-history']) assert.equal((await worker.request(path,{headers},bindings)).status,403,path);
  db.sqlite.close();
});
