import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
const secret = "test-only-auth-secret-with-at-least-32-characters";
async function fixture() {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','',1,1),('player','Player','player@example.test','',0,1); INSERT INTO teams(id,name,join_code,captain_id) VALUES ('team','Team','CODE','player'); INSERT INTO team_members(id,team_id,user_id) VALUES ('member','team','player')");
  const flag = "f".repeat(300);
  db.sqlite.prepare("INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('challenge','Challenge','Description','',100,'constructor','Admin',?)").run(flag);
  const admin = await sign({ userId: "admin", isAdmin: true, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret);
  const player = await sign({ userId: "player", username: "Player", isAdmin: false, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret);
  const env = { DATABASE: db, AUTH_SECRET: secret };
  const request = (path, input, method="POST", adminOnly=true) => app.request(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminOnly ? admin : player}` }, body: JSON.stringify(input) }, env);
  return { db, env, admin, player, request, flag };
}
test("challenge deletion queues completed attachments and pending uploads before cascading their rows", async () => {
  const { db, request } = await fixture();
  db.sqlite.exec(`
    INSERT INTO attachments(id,challenge_id,object_key,filename,content_type,size) VALUES ('file','challenge','challenge/file','file.zip','application/zip',4);
    INSERT INTO attachment_uploads(id,attachment_id,challenge_id,owner_id,object_key,upload_id,filename,content_type,size,part_size,expires_at)
    VALUES ('upload','pending-file','challenge','admin','challenge/pending-file','multipart-id','pending.zip','application/zip',4,16777216,${Date.now()+60000});
  `);
  const response = await request("/api/challenges/delete/challenge", {}, "DELETE");
  assert.equal(response.status, 200);
  assert.deepEqual(db.sqlite.prepare("SELECT object_key FROM r2_cleanup_jobs ORDER BY object_key").all().map((row) => row.object_key), ["challenge/file", "challenge/pending-file"]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM attachments WHERE challenge_id='challenge'").get().n, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM attachment_uploads WHERE challenge_id='challenge'").get().n, 0);
  db.sqlite.close();
});
test("flags accepted by organizer validation remain submittable above 256 characters", async () => {
  const { db, request, flag } = await fixture();
  const response = await request("/api/challenges/submit/challenge", { flag }, "POST", false);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).submission.isCorrect, true);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM team_solves").get().count, 1);
  db.sqlite.close();
});
test("challenge submissions and hint purchases fail closed when event settings are missing", async () => {
  const { db, request, flag, env, player, admin } = await fixture();
  db.sqlite.exec("DELETE FROM event_settings; INSERT INTO challenge_hints(id,challenge_id,body,cost) VALUES ('hint','challenge','Secret hint',0)");
  const submission = await request("/api/challenges/submit/challenge", { flag }, "POST", false);
  assert.equal(submission.status, 409);
  const hint = await request("/api/challenges/hints/hint/unlock", {}, "POST", false);
  assert.equal(hint.status, 409);
  for (const path of [
    "/api/challenges/read",
    "/api/challenges/challenge/hints",
    "/api/attachments/challenge/challenge",
    "/api/challenges/leaderboard",
    "/api/challenges/scoreboard-history",
    "/api/teams/team",
  ]) {
    const response = await app.request(path, { headers: { Authorization: `Bearer ${player}` } }, env);
    assert.notEqual(response.status, 200, path);
  }
  assert.equal((await app.request("/api/challenges/read", { headers: { Authorization: `Bearer ${admin}` } }, env)).status, 200);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM submissions").get().count, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS count FROM hint_unlocks").get().count, 0);
  db.sqlite.close();
});
test("challenge deletion reports missing resources and returns only deletion metadata", async () => {
  const { db, request } = await fixture();
  const missing = await request('/api/challenges/delete/missing', {}, 'DELETE');
  assert.equal(missing.status,404);
  const deleted = await request('/api/challenges/delete/challenge', {}, 'DELETE');
  assert.equal(deleted.status,200);
  const metadata = await deleted.json();
  assert.equal(metadata.id,'challenge');
  assert.equal('flag' in metadata,false);
  assert.equal((await request('/api/challenges/delete/challenge', {}, 'DELETE')).status,404);
  db.sqlite.close();
});
test('an incorrect in-flight attempt cannot be recorded after a concurrent solve',async()=>{
  const {db,request}=await fixture();
  const batch=db.batch.bind(db);
  db.batch=async(statements)=>{
    db.sqlite.exec("INSERT INTO submissions(id,userId,teamId,challengeId,input,timestamp,isCorrect) VALUES ('winning','player','team','challenge','correct',1000,1); INSERT INTO team_solves(id,team_id,challenge_id,submission_id,solved_at) VALUES ('solve','team','challenge','winning',1000)");
    return batch(statements);
  };
  const response=await request('/api/challenges/submit/challenge',{flag:'wrong'},'POST',false);
  assert.equal(response.status,400);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,1);
  db.sqlite.close();
});
test('submissions enforce an attempt limit lowered after challenge lookup',async()=>{
  const {db,request}=await fixture();
  db.sqlite.exec("UPDATE challenges SET max_attempts=5; INSERT INTO submissions(id,userId,teamId,challengeId,input,timestamp,isCorrect) VALUES ('prior','player','team','challenge','wrong',1000,0)");
  const batch=db.batch.bind(db);
  db.batch=async(statements)=>{db.sqlite.exec('UPDATE challenges SET max_attempts=1');return batch(statements);};
  const response=await request('/api/challenges/submit/challenge',{flag:'wrong'},'POST',false);
  assert.equal(response.status,429);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,1);
  db.sqlite.close();
});
test('hint purchases reject a price changed after the hint was read',async()=>{
  const {db,request}=await fixture();
  db.sqlite.exec("INSERT INTO challenge_hints(id,challenge_id,body,cost) VALUES ('hint','challenge','Hint body',0)");
  const prepare=db.prepare;
  const wrap=(statement)=>({...statement,bind:(...values)=>wrap(statement.bind(...values)),async run(){
    if(statement.sql.includes('INSERT INTO hint_unlocks'))db.sqlite.exec("UPDATE challenge_hints SET cost=10 WHERE id='hint'");
    return statement.run();
  }});
  db.prepare=(sql)=>wrap(prepare(sql));
  const response=await request('/api/challenges/hints/hint/unlock',{},'POST',false);
  assert.equal(response.status,409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM hint_unlocks').get().n,0);
  db.sqlite.close();
});
for (const secondary of [false,true]) test(`a removed ${secondary?'secondary':'primary'} flag cannot earn a solve`,async()=>{
  const {db,request,flag}=await fixture();const batch=db.batch.bind(db);let edited=false;
  if(secondary){
    db.sqlite.exec("UPDATE challenges SET flag='primary'; INSERT INTO challenge_flags(id,challenge_id,value,type) VALUES ('primary','challenge','primary','static')");
    db.sqlite.prepare("INSERT INTO challenge_flags(id,challenge_id,value,type) VALUES ('secondary','challenge',?,'static')").run(flag);
  }
  db.batch=async(statements)=>{
    if(!edited){edited=true;const update=await request('/api/challenges/update/challenge',{flags:[{value:secondary?'primary':'replacement-flag',type:'static'}]},'PUT');assert.equal(update.status,200);}
    return batch(statements);
  };
  const response=await request('/api/challenges/submit/challenge',{flag},'POST',false);
  assert.equal(response.status,409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM team_solves').get().n,0);
  db.sqlite.close();
});

for (const [label, mutation] of [
  ["membership removed", "DELETE FROM team_members WHERE user_id='player'"],
  ["team banned", "UPDATE teams SET is_banned=1 WHERE id='team'"],
  ["account banned", "UPDATE user SET is_banned=1 WHERE id='player'"],
  ["session revoked", "UPDATE user SET auth_version=auth_version+1 WHERE id='player'"],
  ["event paused", "UPDATE event_settings SET paused=1"],
  ["event ended", "UPDATE event_settings SET ends_at=1"],
  ["event moved into the future", "UPDATE event_settings SET starts_at=9999999999999"],
  ["challenge hidden", "UPDATE challenges SET is_visible=0"],
]) {
  test(`submission cannot credit a stale team after ${label}`, async () => {
    const { db, request, flag } = await fixture();
    const batch = db.batch.bind(db);
    db.batch = async (statements) => { db.sqlite.exec(mutation); return batch(statements); };
    const response = await request("/api/challenges/submit/challenge", { flag }, "POST", false);
    assert.equal(response.status, 409);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM submissions").get().n, 0);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM team_solves").get().n, 0);
    db.sqlite.close();
  });
  test(`hint purchase cannot use a stale team after ${label}`, async () => {
    const { db, request } = await fixture();
    db.sqlite.exec("INSERT INTO challenge_hints(id,challenge_id,body,cost) VALUES ('hint','challenge','Secret hint',0)");
    const prepare = db.prepare;
    const wrap = (statement) => ({ ...statement,
      bind: (...values) => wrap(statement.bind(...values)),
      async run() {
        if (statement.sql.includes('INSERT INTO hint_unlocks')) db.sqlite.exec(mutation);
        return statement.run();
      },
    });
    db.prepare = (sql) => wrap(prepare(sql));
    const response = await request("/api/challenges/hints/hint/unlock", {}, "POST", false);
    assert.equal(response.status, 409);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM hint_unlocks").get().n, 0);
    db.sqlite.close();
  });
}
test("custom category names cannot collide with object prototype properties", async () => {
  const { db, env, player } = await fixture();
  for (const category of ["constructor", "__proto__", "toString"]) {
    db.sqlite.prepare("UPDATE challenges SET category=?").run(category);
    const response = await app.request("/api/challenges/read", { headers: { Authorization: `Bearer ${player}` } }, env);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).challenges[0].category, category);
  }
  db.sqlite.close();
});
test("a failed organizer create is never reported as a successful save", async () => {
  const { db, request } = await fixture();
  db.batch = async () => { throw new Error("Database unavailable"); };
  const response = await request("/api/challenges/create", { name: "Test", description: "Description", url: "", points: 100, author: "Admin", category: "Web", flag: "flag{test}" });
  assert.equal(response.status, 500);
  assert.equal(db.sqlite.prepare("SELECT count(*) AS count FROM challenges").get().count, 1);
  db.sqlite.close();
});
test("organizers can author challenges before and after the participant event window", async () => {
  const { db, env, admin, player } = await fixture();
  for (const settings of ["starts_at=9999999999999", "starts_at=NULL,ends_at=1,view_challenges_after_end=0"]) {
    db.sqlite.exec(`UPDATE event_settings SET ${settings}`);
    assert.equal((await app.request("/api/challenges/read", { headers: { Authorization: `Bearer ${admin}` } }, env)).status, 200);
    assert.equal((await app.request("/api/challenges/read", { headers: { Authorization: `Bearer ${player}` } }, env)).status, 403);
  }
  db.sqlite.close();
});
test("organizer JSON handlers reject malformed roots and flag types without server errors", async () => {
  const { db, request } = await fixture();
  for (const [path, method] of [["/api/challenges/create","POST"], ["/api/challenges/update/challenge","PUT"], ["/api/event/settings","PUT"], ["/api/event/invitations","POST"], ["/api/attachments/multipart","POST"]]) {
    assert.equal((await request(path, null, method)).status, 400, path);
  }
  const payload = { name: "Test", description: "Description", url: "", points: 100, author: "Admin", category: "Web", flags: [{ value: 123, type: "static" }] };
  assert.equal((await request("/api/challenges/create", payload)).status, 400);
  assert.equal((await request("/api/challenges/update/challenge", { date: {} }, "PUT")).status, 400);
  db.sqlite.close();
});
test('challenge authoring rejects coercible nonnumeric limits and hint prices',async()=>{
  const {db,request}=await fixture();
  const base={name:'New challenge',description:'Description',url:'',points:100,author:'Admin',category:'web',flags:[{value:'flag',type:'static'}]};
  for(const patch of [{maxAttempts:true},{maxAttempts:[2]},{hints:[{body:'Hint',cost:false}]},{hints:[{body:'Hint',cost:[1]}]},{hints:[{body:'Hint',cost:''}]}]){
    assert.equal((await request('/api/challenges/create',{...base,...patch})).status,400,JSON.stringify(patch));
    assert.equal((await request('/api/challenges/update/challenge',patch,'PUT')).status,400,JSON.stringify(patch));
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM challenges').get().n,1);
  db.sqlite.close();
});
test('challenge launch URLs must parse as HTTPS addresses or same-origin paths',async()=>{
  const {db,request}=await fixture();
  const base={name:'URL check',description:'Description',points:100,author:'Admin',category:'web',flags:[{value:'flag',type:'static'}]};
  for(const url of ['https://','https://bad host.test','https://%zz','//external.test','/\\external.test','javascript:alert(1)','https://name:password@example.test']){
    assert.equal((await request('/api/challenges/create',{...base,url})).status,400,url);
    assert.equal((await request('/api/challenges/update/challenge',{url},'PUT')).status,400,url);
  }
  for(const url of ['/challenge/service','https://example.test/challenge'])assert.equal((await request('/api/challenges/update/challenge',{url},'PUT')).status,200,url);
  db.sqlite.close();
});
