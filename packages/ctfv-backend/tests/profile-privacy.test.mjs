import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";
const app = await loadWorker();
test("public user directory excludes unverified and banned accounts", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified,isAdmin,is_banned,rollNo,instituteName) VALUES ('verified','Verified','verified@example.test','unused',1,0,0,'private-roll','Private Institute'),('unverified','Unverified','unverified@example.test','unused',0,0,0,'private-unverified','Hidden'),('banned','Banned','banned@example.test','unused',1,0,1,'private-banned','Hidden'),('admin','Admin','admin@example.test','unused',1,1,0,'private-admin','Hidden')");
  const response = await app.request("/api/users", {}, { DATABASE: db });
  assert.equal(response.status, 200);
  const profiles = await response.json();
  assert.deepEqual(profiles.map((profile) => profile.id), ["verified"]);
  assert.equal("rollNo" in profiles[0], false);
  assert.equal("instituteName" in profiles[0], false);
  db.sqlite.close();
});
test("profile email access depends on identity and role, never optional username claims", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified,isAdmin,rollNo,instituteName) VALUES ('p','Player','p@example.test','unused',1,0,'own-roll','Own Institute'),('q','Other','q@example.test','unused',1,0,'other-roll','Other Institute'),('a','Admin','a@example.test','unused',1,1,'admin-roll','Admin Institute')");
  const secret='profile-privacy-test-secret';
  const request = async (viewer,isAdmin,target,username) => {
    const token=await sign({userId:viewer,isAdmin,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60,...(username===undefined?{}:{username})},secret);
    return app.request(`/api/users/${target}`,{headers:{Authorization:`Bearer ${token}`}},{DATABASE:db,AUTH_SECRET:secret});
  };
  for (const username of [undefined,null,'Player']) {
    const publicProfile=await request('p',false,'q',username);
    assert.equal(publicProfile.status,200);
    const profile=await publicProfile.json();
    assert.equal('email' in profile,false,'optional username must not grant private email access');
    assert.equal(profile.username,'Other');
    assert.equal('rollNo' in profile,false);
    assert.equal('instituteName' in profile,false);
    assert.equal((await (await request('p',false,'p',username)).json()).email,'p@example.test');
    const ownProfile=await (await request('p',false,'p',username)).json();
    assert.equal(ownProfile.rollNo,'own-roll');
    assert.equal(ownProfile.instituteName,'Own Institute');
    assert.equal((await request('p',false,'a',username)).status,404);
  }
  assert.equal((await (await request('a',true,'q')).json()).email,'q@example.test');
  assert.equal((await (await request('a',true,'a')).json()).email,'a@example.test');
  db.sqlite.close();
});
