import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sign } from 'hono/jwt';
import { createDatabase,loadWorker } from './helpers.mjs';
const app=await loadWorker();
test('unauthorized upload requests are rejected before their streaming bodies are consumed',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('p','P','p@example.test','unused',1)");
  const secret='upload-authorization-test-secret';
  const token=await sign({userId:'p',isAdmin:false,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  for(const [authorization,status] of [[undefined,401],[`Bearer ${token}`,403]]){
    let reads=0;
    const body=new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array([1,2,3]));controller.close();}},{highWaterMark:0});
    const request=new Request('http://localhost/api/attachments/multipart/session/parts/1',{method:'PUT',headers:authorization?{Authorization:authorization}:{},body,duplex:'half'});
    const response=await app.request(request,undefined,{DATABASE:db,AUTH_SECRET:secret});
    assert.equal(response.status,status);
    assert.equal(reads,0,'stream must remain unread before authentication and admin authorization');
  }
  db.sqlite.exec("UPDATE user SET isAdmin=1 WHERE id='p'");
  const admin=await sign({userId:'p',isAdmin:true,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const oversized=await app.request('/api/attachments/multipart/session/parts/1',{method:'PUT',headers:{Authorization:`Bearer ${admin}`,'Content-Length':String(90*1024*1024+1)},body:'x'},{DATABASE:db,AUTH_SECRET:secret});
  assert.equal(oversized.status,413,'organizer uploads must retain the multipart size limit');
  db.sqlite.close();
});
