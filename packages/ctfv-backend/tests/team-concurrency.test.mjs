import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";

const app = await loadWorker();
const secret = "team-concurrency-test-only-secret";
async function fixture() {
  const db = createDatabase();
  db.sqlite.exec(`
    INSERT INTO user(id,name,email,password,emailVerified) VALUES
      ('captain','Captain','captain@example.test','unused',1),
      ('member','Member','member@example.test','unused',1);
    INSERT INTO teams(id,name,join_code,captain_id) VALUES ('team','Original','JOIN','captain');
    INSERT INTO team_members(id,team_id,user_id) VALUES ('c','team','captain'),('m','team','member');
  `);
  const headers = async (userId) => ({ "Content-Type": "application/json", Authorization: `Bearer ${await sign({ userId, isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret)}` });
  // Simulate another D1 request committing after a read completes, before its caller resumes.
  const interleave = (matches, mutate) => {
    const original = db.prepare;
    let injected = false;
    const wrap = (statement) => ({
      ...statement,
      bind: (...values) => wrap(statement.bind(...values)),
      async raw() {
        const rows = await statement.raw();
        if (!injected && matches(statement.sql)) { injected = true; mutate(); }
        return rows;
      },
    });
    db.prepare = (sql) => wrap(original(sql));
    return () => assert.equal(injected, true, "concurrent change must be exercised");
  };
  return { db, headers, interleave, env: { DATABASE: db, AUTH_SECRET: secret } };
}

test("leaving cannot remove a member promoted to captain after the membership read", async () => {
  const f = await fixture();
  const checked = f.interleave((sql) => sql.startsWith('select') && sql.includes('"team_members"') && sql.includes('"captain_id"'), () => {
    f.db.sqlite.exec("UPDATE teams SET captain_id='member' WHERE id='team'");
  });
  const response = await app.request("/api/teams/leave", { method: "POST", headers: await f.headers("member") }, f.env);
  checked();
  assert.equal(response.status, 409);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id='member'").get().n, 1);
  f.db.sqlite.close();
});

test("former captain cannot rename a team after a concurrent captaincy transfer", async () => {
  const f = await fixture();
  const checked = f.interleave((sql) => sql.startsWith('select') && sql.includes('from "teams"'), () => {
    f.db.sqlite.exec("UPDATE teams SET captain_id='member' WHERE id='team'");
  });
  const response = await app.request("/api/teams/team", { method: "PUT", headers: await f.headers("captain"), body: JSON.stringify({ name: "Unauthorized rename" }) }, f.env);
  checked();
  assert.equal(response.status, 409);
  assert.equal(f.db.sqlite.prepare("SELECT name FROM teams WHERE id='team'").get().name, "Original");
  f.db.sqlite.close();
});

test("ordinary member leave and captain rename still succeed", async () => {
  const f = await fixture();
  const rename = await app.request("/api/teams/team", { method: "PUT", headers: await f.headers("captain"), body: JSON.stringify({ name: "Renamed" }) }, f.env);
  assert.equal(rename.status, 200);
  const leave = await app.request("/api/teams/leave", { method: "POST", headers: await f.headers("member") }, f.env);
  assert.equal(leave.status, 200);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id='member'").get().n, 0);
  f.db.sqlite.close();
});
test('joining respects a team-size limit lowered after the event settings were read',async()=>{
  const f=await fixture();
  f.db.sqlite.exec("DELETE FROM team_members WHERE user_id='member'; UPDATE event_settings SET max_team_size=4");
  const prepare=f.db.prepare;
  let changed=false;
  const wrap=(statement)=>({...statement,bind:(...values)=>wrap(statement.bind(...values)),async run(){
    if(statement.sql.includes('INSERT INTO team_members')){changed=true;f.db.sqlite.exec('UPDATE event_settings SET max_team_size=1');}
    return statement.run();
  }});
  f.db.prepare=(sql)=>wrap(prepare(sql));
  const response=await app.request('/api/teams/join',{method:'POST',headers:await f.headers('member'),body:JSON.stringify({joinCode:'JOIN'})},f.env);
  assert.equal(changed,true);
  assert.equal(response.status,409);
  assert.equal(f.db.sqlite.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id='team'").get().n,1);
  f.db.sqlite.close();
});
