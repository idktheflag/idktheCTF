import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
const secret = "test-only-auth-secret-with-at-least-32-characters";
const paths = ["/api/submissions/read", "/api/submissions/readbyuserid/player", "/api/submissions/readbychallengeid/challenge"];
async function fixture() {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user (id,name,email,password,emailVerified) VALUES ('player','player','player@example.test','unused',1); INSERT INTO teams (id,name,join_code,captain_id) VALUES ('team','Team','CODE','player'); INSERT INTO team_members(id,team_id,user_id) VALUES ('member','team','player'); INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('challenge','Challenge','private description','',100,'web','admin','secret'); INSERT INTO submissions(id,userId,challengeId,input,timestamp,isCorrect,teamId) VALUES ('attempt','player','challenge','secret',2000,1,'team');");
  const token = await sign({ userId: "player", isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret);
  return { db, env: { DATABASE: db, AUTH_SECRET: secret }, headers: { Authorization: `Bearer ${token}` } };
}
for (const [name, mutation] of [
  ["private scoreboard", "UPDATE event_settings SET scoreboard_public=0"],
  ["scoreboard freeze", "UPDATE event_settings SET scoreboard_frozen_at=1000"],
  ["hidden challenge", "UPDATE challenges SET is_visible=0"],
  ["closed post-event access", "UPDATE event_settings SET ends_at=1000,view_challenges_after_end=0"],
]) {
  test(`submission history respects ${name}`, async () => {
    const { db, env, headers } = await fixture();
    db.sqlite.exec(mutation);
    for (const path of paths) {
      const response = await app.request(path, { headers }, env);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), [], path);
    }
    db.sqlite.close();
  });
}
test("public visible correct submissions remain available", async () => {
  const { db, env, headers } = await fixture();
  for (const path of paths) {
    const response = await app.request(path, { headers }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).length, 1);
  }
  db.sqlite.close();
});
