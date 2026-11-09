import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
const secret = "test-only-auth-secret-with-at-least-32-characters";
for (const path of ["register", "login"]) {
  test(`${path} rejects non-object or malformed JSON without a server error`, async () => {
    const db = createDatabase();
    for (const body of ["null", "[]", '"text"', "{"]) {
      const response = await app.request(`/api/users/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body }, { DATABASE: db, AUTH_SECRET: secret });
      assert.equal(response.status, 400, body);
    }
    db.sqlite.close();
  });
}
test("team inputs reject non-string names and join codes", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('player','player','player@example.test','unused',1)");
  const token = await sign({ userId: "player", username: "player", isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret);
  for (const [path, input] of [["/api/teams", { name: 123 }], ["/api/teams/join", { joinCode: 123 }]]) {
    const response = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input) }, { DATABASE: db, AUTH_SECRET: secret });
    assert.equal(response.status, 400);
  }
  db.sqlite.close();
});
test('team creation reports infrastructure failures as server errors',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('player','Player','player@example.test','unused',1)");
  db.batch=async()=>{throw new Error('Database unavailable');};
  const token=await sign({userId:'player',isAdmin:false,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const response=await app.request('/api/teams',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:'Valid team'})},{DATABASE:db,AUTH_SECRET:secret});
  assert.equal(response.status,500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM teams').get().n,0);
  db.sqlite.close();
});
test("profile updates reject invalid field types, excessive size and unsupported URL schemes", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('player','player','player@example.test','unused',1)");
  const token = await sign({ userId: "player", username: "player", isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret);
  const env = { DATABASE: db, AUTH_SECRET: secret };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  for (const input of [null, [], { affiliation: {} }, { country: "a".repeat(101) }, { website: "javascript:alert(1)" }, {}]) {
    const response = await app.request("/api/users/player", { method: "PUT", headers, body: JSON.stringify(input) }, env);
    assert.equal(response.status, 400, JSON.stringify(input));
  }
  const response = await app.request("/api/users/player", { method: "PUT", headers, body: JSON.stringify({ country: "Canada", website: "https://example.test/" }) }, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).country, "Canada");
  const bare = await app.request("/api/users/player", { method: "PUT", headers, body: JSON.stringify({ website: "example.test/profile" }) }, env);
  assert.equal(bare.status, 200);
  assert.equal((await bare.json()).website, "https://example.test/profile");
  db.sqlite.close();
});
