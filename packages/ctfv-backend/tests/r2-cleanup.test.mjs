import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, loadWorker } from "./helpers.mjs";

const app = await loadWorker();

test("scheduled cleanup deletes successful objects and retains failed R2 deletes for retry", async () => {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO r2_cleanup_jobs(object_key) VALUES ('deleted/object'),('retry/object')");
  const now = Date.now();
  db.sqlite.exec("INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('challenge','Challenge','Description','',1,'test','test','flag')");
  db.sqlite.prepare("INSERT INTO attachment_uploads(id,attachment_id,challenge_id,owner_id,object_key,upload_id,filename,content_type,size,part_size,expires_at) VALUES ('expired','attachment','challenge','admin','challenge/expired','multipart-id','file.zip','application/zip',4,16777216,?)").run(now - 1);
  const deleted = [];
  const aborted = [];
  const env = {
    DATABASE: db,
    FILES: {
      async delete(key) {
        if (key === "retry/object") throw new Error("temporary R2 failure");
        deleted.push(key);
      },
      resumeMultipartUpload(key, uploadId) {
        return { async abort() { aborted.push([key, uploadId]); } };
      },
    },
  };
  let scheduledWork;
  app.scheduled({}, env, { waitUntil(promise) { scheduledWork = promise; } });
  await scheduledWork;

  assert.deepEqual(deleted.sort(), ["challenge/expired", "deleted/object"]);
  assert.deepEqual(aborted, [["challenge/expired", "multipart-id"]]);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM attachment_uploads WHERE id='expired'").get().n, 0);
  assert.deepEqual(db.sqlite.prepare("SELECT object_key FROM r2_cleanup_jobs ORDER BY object_key").all().map((row) => row.object_key), ["retry/object"]);
  const retry = db.sqlite.prepare("SELECT attempts, next_attempt_at FROM r2_cleanup_jobs WHERE object_key='retry/object'").get();
  assert.equal(retry.attempts, 1);
  assert.ok(retry.next_attempt_at > Date.now());
  db.sqlite.close();
});
