import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sign } from 'hono/jwt';
import { createDatabase,loadWorker } from './helpers.mjs';
const app=await loadWorker();
test('restoring a banned account does not revive its pre-ban sessions',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('a','Admin','a@example.test','unused',1,1),('p','Player','p@example.test','unused',0,1)");
  const secret='ban-revocation-test-secret';
  const token=async(userId,isAdmin)=>sign({userId,isAdmin,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const admin=await token('a',true);const player=await token('p',false);
  const env={DATABASE:db,AUTH_SECRET:secret};
  const read=()=>app.request('/api/teams/me',{headers:{Authorization:`Bearer ${player}`}},env);
  assert.equal((await read()).status,200);
  for(const isBanned of [true,false]){
    const response=await app.request('/api/admin/users/p/ban',{method:'PATCH',headers:{Authorization:`Bearer ${admin}`,'Content-Type':'application/json'},body:JSON.stringify({isBanned})},env);
    assert.equal(response.status,200);
    assert.equal((await read()).status,isBanned?403:401);
  }
  assert.equal((await app.request('/api/challenges/leaderboard',{headers:{Authorization:`Bearer ${player}`}},env)).status,401);
  db.sqlite.close();
});
