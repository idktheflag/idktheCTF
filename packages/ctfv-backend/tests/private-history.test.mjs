import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
test("participant history filters in D1 using its user index; organizers retain all attempts", async () => {
  const db = createDatabase();
  const secret = "history-test-only-secret";
  db.sqlite.exec(`
    INSERT INTO user(id,name,email,password,emailVerified,isAdmin) VALUES ('p','P','p@example.test','unused',1,0),('q','Q','q@example.test','unused',1,0),('admin','Admin','a@example.test','unused',1,1);
    INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('c','C','Description','',100,'web','Admin','secret');
    INSERT INTO submissions(id,userId,challengeId,input,timestamp,isCorrect) VALUES ('p1','p','c','wrong',1000,0),('q1','q','c','private',2000,0),('p2','p','c','secret',3000,1);
  `);
  const reads = [];
  const prepare = db.prepare;
  const wrap = (statement) => ({ ...statement, bind: (...values) => wrap(statement.bind(...values)), async raw() {
    if (statement.sql.includes('from "submissions"')) reads.push({ sql: statement.sql, values: statement.values });
    return statement.raw();
  }});
  db.prepare = (sql) => wrap(prepare(sql));
  for (const [userId,isAdmin,ids] of [['p',false,['p1','p2']],['admin',true,['p1','q1','p2']]]) {
    const token = await sign({ userId, isAdmin, emailVerified:true, authVersion:0, exp:Math.floor(Date.now()/1000)+60 },secret);
    const response = await app.request('/api/challenges/submissions',{ headers:{ Authorization:`Bearer ${token}` } },{ DATABASE:db,AUTH_SECRET:secret });
    assert.equal(response.status,200);
    assert.deepEqual((await response.json()).submissions.map((s)=>s.id),ids);
    if (!isAdmin) {
      const query = reads.at(-1);
      const plan = db.sqlite.prepare('EXPLAIN QUERY PLAN '+query.sql).all(...query.values).map((r)=>r.detail).join('\n');
      assert.match(plan,/SEARCH submissions USING INDEX submissions_user_timestamp_idx/);
      assert.doesNotMatch(plan,/TEMP B-TREE/);
    }
  }
  db.sqlite.close();
});

test("team profiles hide the names of hidden challenges while keeping the published score", async () => {
  const db = createDatabase();
  const secret = "history-test-only-secret";
  db.sqlite.exec(`
    INSERT INTO user(id,name,email,password,emailVerified,isAdmin) VALUES ('p','P','p@example.test','unused',1,0);
    INSERT INTO teams(id,name,join_code,captain_id) VALUES ('t','Team','JOIN123','p');
    INSERT INTO team_members(id,team_id,user_id) VALUES ('m','t','p');
    INSERT INTO challenges(id,name,description,url,points,category,author,flag,is_visible) VALUES
      ('public','Public challenge','Description','',100,'web','Admin','secret',1),
      ('hidden','Hidden challenge','Private description','',200,'web','Admin','private',0);
    INSERT INTO submissions(id,userId,challengeId,input,timestamp,isCorrect,teamId) VALUES
      ('s1','p','public','secret',1000,1,'t'),('s2','p','hidden','private',2000,1,'t');
    INSERT INTO team_solves(id,team_id,challenge_id,submission_id,solved_at) VALUES
      ('solve1','t','public','s1',1000),('solve2','t','hidden','s2',2000);
  `);
  const token = await sign({ userId:"p", isAdmin:false, emailVerified:true, authVersion:0, exp:Math.floor(Date.now()/1000)+60 },secret);
  const response = await app.request('/api/teams/t',{ headers:{ Authorization:`Bearer ${token}` } },{ DATABASE:db,AUTH_SECRET:secret });
  assert.equal(response.status,200);
  const body = await response.json();
  assert.deepEqual(body.solvedChallenges.map((challenge)=>challenge.challengeId),["public"]);
  assert.equal(body.stats.solves,1);
  assert.equal(body.stats.totalPoints,300);
  assert.doesNotMatch(JSON.stringify(body),/Hidden challenge|Private description|"challengeId":"hidden"/);
  db.sqlite.close();
});
