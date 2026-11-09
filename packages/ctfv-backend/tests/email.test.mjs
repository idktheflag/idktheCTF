import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
const request = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "player@example.test" }) };
async function verificationRequest() {
  const token = await sign({ userId: "player", isAdmin: false, emailVerified: false, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 60 }, "test-secret");
  return { ...request, headers: { ...request.headers, Authorization: `Bearer ${token}` } };
}
function fixture(send) {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password) VALUES ('player','player','player@example.test','unused')");
  return { db, env: { DATABASE: db, AUTH_SECRET: "test-secret", APP_URL: "https://ctf.example.test", EMAIL_FROM: "wrong@example.test", EMAIL: { send } } };
}
test("verification uses the pinned sender and allows retry after a minute", async () => {
  let sentMessage;
  const { db, env } = fixture(async (message) => { sentMessage = message; return { messageId: "test-message" }; });
  db.sqlite.prepare("UPDATE user SET lastVerificationEmailSent=?").run(Date.now()-61000);
  const response = await app.request("/api/users/auth/send-verify-email", await verificationRequest(), env);
  assert.equal(response.status, 200);
  assert.equal(sentMessage.from, "no-reply@idktheflag.sh");
  assert.equal(sentMessage.subject, "Verify your email for idktheCTF");
  db.sqlite.close();
});
test("failed verification delivery reports service unavailability and releases its cooldown", async () => {
  const { db, env } = fixture(async () => { throw Object.assign(new Error("provider failure"), { code: "TEST_PROVIDER_DOWN" }); });
  const response = await app.request("/api/users/auth/send-verify-email", await verificationRequest(), env);
  assert.equal(response.status, 503);
  assert.equal(db.sqlite.prepare("SELECT lastVerificationEmailSent FROM user").get().lastVerificationEmailSent, null);
  db.sqlite.close();
});
test("a failed reset-email retry preserves an earlier usable reset link", async () => {
  const { db, env } = fixture(async () => { throw new Error("provider failure"); });
  db.sqlite.prepare("INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES ('old-token','player',?)").run(Date.now()+60000);
  const response = await app.request("/api/users/auth/password-reset/request", request, env);
  assert.equal(response.status, 200);
  assert.ok(db.sqlite.prepare("SELECT token_hash FROM password_reset_tokens WHERE token_hash='old-token'").get());
  db.sqlite.close();
});
