import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sign } from 'hono/jwt';
import { createDatabase,loadWorker } from './helpers.mjs';
const app=await loadWorker();
test('event settings reject wrong field types without clearing dates or coercing team limits',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','unused',1,1); UPDATE event_settings SET starts_at=1000,ends_at=2000,scoreboard_frozen_at=1500");
  const secret='event-input-test-secret';
  const token=await sign({userId:'admin',isAdmin:true,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const patch=async(input)=>app.request('/api/event/settings',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)},{DATABASE:db,AUTH_SECRET:secret});
  for(const input of [{startsAt:false},{endsAt:0},{scoreboardFrozenAt:false},{timezone:123},{maxTeamSize:true},{maxTeamSize:[2]}]){
    const response=await patch(input);
    assert.equal(response.status,400,JSON.stringify(input));
  }
  const row=db.sqlite.prepare('SELECT starts_at,ends_at,scoreboard_frozen_at FROM event_settings').get();
  assert.deepEqual({...row},{starts_at:1000,ends_at:2000,scoreboard_frozen_at:1500});
  assert.equal((await patch({startsAt:null,endsAt:null,scoreboardFrozenAt:null,maxTeamSize:'4',timezone:'UTC'})).status,200);
  db.sqlite.close();
});
