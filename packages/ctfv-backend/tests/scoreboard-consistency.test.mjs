import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
const secret = "scoreboard-consistency-test-secret";
async function fixture() {
  const db = createDatabase();
  db.sqlite.exec(`
    INSERT INTO user(id,name,email,password,emailVerified) VALUES ('p','p','p@example.test','unused',1),('q','q','q@example.test','unused',1),('h','h','h@example.test','unused',1);
    INSERT INTO teams(id,name,join_code,captain_id,hidden) VALUES ('late','Late','L','p',0),('early','Early','E','q',0),('hidden','Hidden','H','h',1);
    INSERT INTO team_members(id,team_id,user_id) VALUES ('pm','late','p'),('qm','early','q'),('hm','hidden','h');
    INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('c','Challenge','description','',100,'web','admin','secret');
    INSERT INTO submissions(id,userId,challengeId,input,timestamp,isCorrect,teamId) VALUES ('sa','p','c','secret',2000,1,'late'),('sb','q','c','secret',1000,1,'early'),('sd','h','c','secret',500,1,'hidden');
    INSERT INTO team_solves(id,team_id,challenge_id,solved_at,submission_id) VALUES ('a','late','c',1000,'sa'),('b','early','c',2000,'sb'),('d','hidden','c',500,'sd');
    INSERT INTO challenge_hints(id,challenge_id,body,cost,sort_order) VALUES ('hint','c','Hint',10,0);
    INSERT INTO hint_unlocks(id,team_id,hint_id,unlocked_at) VALUES ('hu','hidden','hint',400);
  `);
  const token = await sign({ userId: "p", username: "p", isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret);
  return { db, env: { DATABASE: db, AUTH_SECRET: secret }, headers: { Authorization: `Bearer ${token}` } };
}
test("hidden teams are excluded from leaderboard and score history, including hint deductions", async () => {
  const f = await fixture();
  for (const [path, key] of [["leaderboard","leaderboard"],["scoreboard-history","teams"]]) {
    const response = await app.request(`/api/challenges/${path}`, {}, f.env);
    assert.equal(response.status,200);
    assert.deepEqual((await response.json())[key].map((t)=>t.teamId).sort(),["early","late"],path);
  }
  f.db.sqlite.close();
});
test("hidden teams cannot be inspected through personal statistics", async () => {
  const f = await fixture();
  const response = await app.request("/api/challenges/personal/h", { headers:f.headers }, f.env);
  assert.equal(response.status,404);
  f.db.sqlite.close();
});
test("team profile rank matches leaderboard time-based tie breaking", async () => {
  const f = await fixture();
  f.db.sqlite.exec("DELETE FROM hint_unlocks; DELETE FROM team_solves WHERE team_id='hidden'");
  const board = await (await app.request("/api/challenges/leaderboard", {}, f.env)).json();
  const profile = await (await app.request("/api/teams/late", { headers:f.headers }, f.env)).json();
  assert.equal(profile.stats.rank, board.leaderboard.findIndex((t)=>t.teamId==='late')+1);
  f.db.sqlite.close();
});
test('free hints without solves do not create unnamed score-history entries',async()=>{
  const f=await fixture();
  f.db.sqlite.exec("DELETE FROM hint_unlocks; DELETE FROM team_solves; UPDATE challenge_hints SET cost=0; INSERT INTO hint_unlocks(id,team_id,hint_id,unlocked_at) VALUES ('free','late','hint',1000)");
  const response=await app.request('/api/challenges/scoreboard-history',{},f.env);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).teams,[]);
  f.db.sqlite.close();
});
