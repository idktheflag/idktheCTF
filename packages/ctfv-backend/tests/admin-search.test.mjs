import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sign} from 'hono/jwt';
import {createDatabase,loadWorker} from './helpers.mjs';
const app=await loadWorker();
test('admin search handles long UTF-8 queries within D1 limits and treats wildcards literally',async()=>{
  const db=createDatabase();const email='e'.repeat(60)+'@'+'a'.repeat(63)+'.'+'b'.repeat(60)+'.test';const name='界'.repeat(30);const actor='a'.repeat(60);
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','unused',1,1)");
  db.sqlite.prepare("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('p','literal%name',?,'unused',1)").run(email);
  db.sqlite.prepare("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('other','Other',?,'unused',1)").run(email.replace(/\.test$/,'.other'));
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('accent','Élodie','accent@example.test','unused',1)");
  db.sqlite.prepare("INSERT INTO teams(id,name,join_code,captain_id) VALUES ('t',?,'CODE','p')").run(name);
  db.sqlite.prepare("INSERT INTO audit_logs(id,actor_id,actor_username,action,target_type) VALUES ('log','admin',?,'test','team')").run(actor);
  const prepare=db.prepare;
  const wrap=(statement)=>{
    const check=()=>{if(/\bLIKE\b/i.test(statement.sql)&&statement.values.some(v=>typeof v==='string'&&Buffer.byteLength(v)>50))throw new Error('LIKE or GLOB pattern too complex');};
    return {...statement,bind:(...values)=>wrap(statement.bind(...values)),async first(...args){check();return statement.first(...args);},async all(){check();return statement.all();}};
  };
  db.prepare=(sql)=>wrap(prepare(sql));
  const secret='admin-search-test-secret';const token=await sign({userId:'admin',isAdmin:true,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const query=async(route,text)=>{
    const response=await app.request(`/api/admin/${route}?q=${encodeURIComponent(text)}`,{headers:{Authorization:`Bearer ${token}`}},{DATABASE:db,AUTH_SECRET:secret});
    assert.equal(response.status,200,route);return response.json();
  };
  for(const [route,text,id] of [['users',email,'p'],['teams',name.slice(0,20),'t'],['logs',actor,'log']])assert.deepEqual((await query(route,text))[route].map(r=>r.id),[id]);
  assert.deepEqual((await query('users','%')).users.map(r=>r.id),['p']);
  assert.deepEqual((await query('users','_')).users,[]);
  assert.deepEqual((await query('users','ÉLODIE')).users.map(r=>r.id),['accent']);
  db.sqlite.close();
});
