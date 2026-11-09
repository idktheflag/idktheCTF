import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase,loadWorker } from './helpers.mjs';
const app=await loadWorker();
test('unknown API routes return a JSON error with API security headers',async()=>{
  const db=createDatabase();
  const response=await app.request('/api/does-not-exist',{}, {DATABASE:db});
  assert.equal(response.status,404);
  assert.match(response.headers.get('Content-Type'),/application\/json/);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(typeof (await response.json()).error,'string');
  db.sqlite.close();
});
test('oversized-body rejections retain API security and cache headers',async()=>{
  const response=await app.request('/api/users/auth/login',{method:'POST',headers:{'Content-Length':String(1024*1024+1)},body:'x'},{});
  assert.equal(response.status,413);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(typeof (await response.json()).error,'string');
});
