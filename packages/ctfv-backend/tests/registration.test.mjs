import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
const request = (body) => ({ method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "192.0.2.1" }, body: JSON.stringify(body) });

test("registration respects the native rate limiter before creating an account", async () => {
  const db = createDatabase();
  const env = { DATABASE: db, AUTH_SECRET: "test-secret", AUTH_REGISTRATION_LIMITER: { limit: async () => ({ success: false }) } };
  const response = await app.request("/api/users/auth/register", request({ email: "player@example.test", username: "player", password: "test-password-123" }), env);
  assert.equal(response.status, 429);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM user").get().count, 0);
  db.sqlite.close();
});

test("registration rejects passwords that bcrypt would silently truncate", async () => {
  const db = createDatabase();
  const response = await app.request("/api/users/auth/register", request({ email: "player@example.test", username: "player", password: "a".repeat(73) }), { DATABASE: db, AUTH_SECRET: "test-secret" });
  assert.equal(response.status, 400);
  db.sqlite.close();
});
test('duplicate usernames produce an actionable conflict instead of a server error',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('existing','Player','existing@example.test','unused',1)");
  const response=await app.request('/api/users/auth/register',request({email:'new@example.test',username:'Player',password:'new-password-123'}),{DATABASE:db,AUTH_SECRET:'registration-test-secret'});
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/username.*already/i);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM user').get().n,1);
  db.sqlite.close();
});

test("registration does not disclose whether an email already has an account", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('existing','Existing','existing@example.test','unused',1)");
  const env = { DATABASE: db, AUTH_SECRET: "registration-test-secret" };
  const existing = await app.request("/api/users/auth/register", request({ email: "existing@example.test", username: "new-player", password: "new-password-123" }), env);
  const available = await app.request("/api/users/auth/register", request({ email: "new@example.test", username: "new-player-2", password: "new-password-123" }), env);
  const existingWithTakenUsername = await app.request("/api/users/auth/register", request({ email: "existing@example.test", username: "Existing", password: "new-password-123" }), env);
  const availableWithTakenUsername = await app.request("/api/users/auth/register", request({ email: "another@example.test", username: "Existing", password: "new-password-123" }), env);
  assert.equal(existing.status, 200);
  assert.equal(available.status, existing.status);
  assert.deepEqual(await available.json(), await existing.json());
  assert.equal(availableWithTakenUsername.status, existingWithTakenUsername.status);
  assert.deepEqual(await availableWithTakenUsername.json(), await existingWithTakenUsername.json());
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM user").get().n, 2);
  db.sqlite.close();
});
