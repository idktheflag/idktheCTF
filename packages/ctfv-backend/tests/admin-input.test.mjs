import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";

const app = await loadWorker();
const secret = "admin-input-test-secret-with-at-least-32-characters";
const token = await sign({ userId: "admin", isAdmin: true, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, secret, "HS256");

async function withAdmin(run) {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user (id, name, email, password, isAdmin, emailVerified) VALUES ('admin', 'Admin', 'admin@example.test', '', 1, 1), ('a', 'Alpha', 'a@example.test', '', 0, 1), ('z', 'Zulu', 'z@example.test', '', 0, 1)");
  db.sqlite.exec("INSERT INTO teams (id, name, join_code, captain_id) VALUES ('a', 'Alpha', 'alpha', 'a'), ('z', 'Zulu', 'zulu', 'z')");
  db.sqlite.exec("INSERT INTO audit_logs (id, actor_id, actor_username, action, target_type, created_at) VALUES ('a', 'admin', 'Admin', 'alpha', 'team', 1), ('z', 'admin', 'Admin', 'zulu', 'team', 2)");
  const request = (path, authenticated = true) => app.request(`/api/admin/${path}`, { headers: authenticated ? { Authorization: `Bearer ${token}` } : {} }, { DATABASE: db, AUTH_SECRET: secret });
  try { await run(request); } finally { db.sqlite.close(); }
}

for (const route of ["users", "teams", "logs"]) {
  test(`${route} ignores inherited object keys in sort`, () => withAdmin(async (request) => {
    const baseline = await (await request(route)).json();
    for (const sort of ["__proto__", "constructor", "toString", "hasOwnProperty", "unknown"]) {
      const response = await request(`${route}?sort=${sort}`);
      assert.equal(response.status, 200, sort);
      assert.deepEqual(await response.json(), baseline, sort);
    }
  }));

  test(`${route} normalizes nonfinite pagination and bounds oversized offsets`, () => withAdmin(async (request) => {
    for (const page of ["Infinity", "-Infinity", "1e309", "NaN", "-3", "0"]) {
      const response = await request(`${route}?page=${page}`);
      assert.equal(response.status, 200, page);
      assert.equal((await response.json()).page, 1, page);
    }
    for (const pageSize of ["1", "100", "Infinity", "1e309"]) {
      const response = await request(`${route}?page=1e308&pageSize=${pageSize}`);
      assert.equal(response.status, 200, pageSize);
      const body = await response.json();
      assert.ok(Number.isSafeInteger(body.page));
      assert.ok(Number.isSafeInteger((body.page - 1) * body.pageSize));
      assert.ok(body.pageSize >= 1 && body.pageSize <= 100);
      assert.deepEqual(body[route], []);
    }
  }));

  test(`${route} preserves valid sorting, filtering, and pagination behind authentication`, () => withAdmin(async (request) => {
    assert.equal((await request(route, false)).status, 401);
    const sort = route === "users" ? "username" : route === "teams" ? "name" : "action";
    const response = await request(`${route}?sort=${sort}&dir=desc&page=1.9&pageSize=1&q=Zulu`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 1);
    assert.equal(body.total, 1);
    assert.equal(body[route][0].id, "z");
    const secondPage = await (await request(`${route}?sort=${sort}&dir=desc&page=2&pageSize=1`)).json();
    assert.equal(secondPage.page, 2);
    assert.equal(secondPage[route][0].id, "a");
  }));
}

test("moderation requires explicit booleans and preserves ban/unban intent", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','',1,1),('player','Player','player@example.test','',0,1); INSERT INTO teams(id,name,join_code,captain_id) VALUES ('team','Team','CODE','player')");
  const env = { DATABASE: db, AUTH_SECRET: secret };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  for (const [route, id, table] of [["users", "player", "user"], ["teams", "team", "teams"]]) {
    for (const input of [null, [], {}, { isBanned: "false" }, { isBanned: 0 }]) {
      const response = await app.request(`/api/admin/${route}/${id}/ban`, { method: "PATCH", headers, body: JSON.stringify(input) }, env);
      assert.equal(response.status, 400);
      assert.equal(db.sqlite.prepare(`SELECT is_banned FROM ${table} WHERE id=?`).get(id).is_banned, 0);
    }
    for (const isBanned of [true, false]) {
      const response = await app.request(`/api/admin/${route}/${id}/ban`, { method: "PATCH", headers, body: JSON.stringify({ isBanned }) }, env);
      assert.equal(response.status, 200);
      assert.equal(db.sqlite.prepare(`SELECT is_banned FROM ${table} WHERE id=?`).get(id).is_banned, Number(isBanned));
    }
    const missing=await app.request(`/api/admin/${route}/missing/ban`,{method:'PATCH',headers,body:JSON.stringify({isBanned:true})},env);
    assert.equal(missing.status,404,route);
  }
  db.sqlite.close();
});

test("the owner can promote and demote verified accounts with session revocation and audit history", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','',1,1),('other','Other organizer','other@example.test','',1,1),('player','Player','player@example.test','',0,1),('pending','Pending','pending@example.test','',0,0)");
  const env = { DATABASE: db, AUTH_SECRET: secret, OWNER_EMAIL: "admin@example.test" };
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const adminList = await app.request("/api/admin/users", { headers }, env);
  assert.equal((await adminList.json()).canManageRoles, true);
  const otherToken = await sign({ userId: "other", isAdmin: true, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, secret, "HS256");
  const unauthorized = await app.request("/api/admin/users/player/role", { method: "PATCH", headers: { Authorization: `Bearer ${otherToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ isAdmin: true }) }, env);
  assert.equal(unauthorized.status, 403);
  const promote = await app.request("/api/admin/users/player/role", { method: "PATCH", headers, body: JSON.stringify({ isAdmin: true }) }, env);
  assert.equal(promote.status, 200, await promote.text());
  assert.equal(db.sqlite.prepare("SELECT isAdmin, auth_version FROM user WHERE id='player'").get().isAdmin, 1);
  assert.equal(db.sqlite.prepare("SELECT auth_version FROM user WHERE id='player'").get().auth_version, 1);
  const demote = await app.request("/api/admin/users/player/role", { method: "PATCH", headers, body: JSON.stringify({ isAdmin: false }) }, env);
  assert.equal(demote.status, 200, await demote.text());
  assert.equal(db.sqlite.prepare("SELECT isAdmin, auth_version FROM user WHERE id='player'").get().isAdmin, 0);
  assert.equal(db.sqlite.prepare("SELECT auth_version FROM user WHERE id='player'").get().auth_version, 2);
  const pending = await app.request("/api/admin/users/pending/role", { method: "PATCH", headers, body: JSON.stringify({ isAdmin: true }) }, env);
  assert.equal(pending.status, 400);
  const owner = await app.request("/api/admin/users/admin/role", { method: "PATCH", headers, body: JSON.stringify({ isAdmin: false }) }, env);
  assert.equal(owner.status, 400);
  const actions = db.sqlite.prepare("SELECT action FROM audit_logs WHERE target_id='player' ORDER BY created_at, action").all().map((row) => row.action);
  assert.deepEqual(actions, ["organizer.demoted", "organizer.promoted"]);
  db.sqlite.close();
});
