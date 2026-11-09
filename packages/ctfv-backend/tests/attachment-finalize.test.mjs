import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sign } from 'hono/jwt';
import { createDatabase, loadWorker } from './helpers.mjs';
const app=await loadWorker();
for (const failCleanup of [true,false]) test(`attachment finalization is atomic (cleanup failure: ${failCleanup})`,async()=>{
  const db=createDatabase();
  db.sqlite.exec(`INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('a','Admin','a@example.test','unused',1,1);
    INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('c','C','Description','',100,'web','Admin','secret');
    INSERT INTO attachment_uploads(id,attachment_id,challenge_id,owner_id,object_key,upload_id,filename,content_type,size,part_size,expires_at) VALUES ('session','file','c','a','key','r2-upload','test.txt','text/plain',4,16,9999999999999);
    INSERT INTO attachment_upload_parts(id,session_id,part_number,etag,size) VALUES ('part','session',1,'etag',4);`);
  if(failCleanup) db.sqlite.exec("CREATE TRIGGER fail_cleanup BEFORE DELETE ON attachment_uploads BEGIN SELECT RAISE(ABORT,'simulated cleanup failure'); END");
  let deleted=false;
  let objectPresent=false;
  let completions=0;
  const secret='attachment-finalization-test-secret';
  const token=await sign({userId:'a',isAdmin:true,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
  const env={DATABASE:db,AUTH_SECRET:secret,FILES:{head:async()=>objectPresent?{size:4}:null,resumeMultipartUpload:()=>({complete:async()=>{completions++;if(objectPresent)throw new Error('Multipart upload already completed');objectPresent=true;return{};}}),delete:async()=>{deleted=true;objectPresent=false;}}};
  const complete=()=>app.request('/api/attachments/multipart/session/complete',{method:'POST',headers:{Authorization:`Bearer ${token}`}},env);
  const response=await complete();
  assert.equal(response.status,failCleanup?500:201);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,failCleanup?0:1,'failed finalization must not leave an attachment pointing at deleted R2 data');
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM attachment_uploads').get().n,failCleanup?1:0);
  assert.equal(deleted,false,'a retryable database failure must preserve the private completed file');
  if(failCleanup){
    db.sqlite.exec('DROP TRIGGER fail_cleanup');
    const retry=await complete();
    assert.equal(retry.status,201);
    assert.equal(completions,1,'retry must reuse the completed R2 object');
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get().n,1);
    assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM attachment_uploads').get().n,0);
  }
  db.sqlite.close();
});
