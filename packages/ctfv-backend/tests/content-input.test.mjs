import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { createDatabase, loadWorker } from "./helpers.mjs";

const app = await loadWorker();
const secret = "content-input-test-secret-at-least-32-characters";
const token = await sign({ userId: "admin", isAdmin: true, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, secret, "HS256");

test('renaming a page to an existing slug reports a conflict without changing either page',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','unused',1,1); INSERT INTO content_pages(id,slug,title,body,published) VALUES ('one','first','First','Body',1),('two','second','Second','Body',1)");
  const response=await app.request('/api/content/admin/pages/two',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({slug:'first'})},{DATABASE:db,AUTH_SECRET:secret});
  assert.equal(response.status,409);
  assert.match((await response.json()).error,/slug.*exists/i);
  assert.deepEqual(db.sqlite.prepare('SELECT slug FROM content_pages ORDER BY id').all().map(r=>r.slug),['first','second']);
  db.sqlite.close();
});
test('page creation distinguishes duplicate slugs from infrastructure failures',async()=>{
  const db=createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','unused',1,1)");
  const create=(slug)=>app.request('/api/content/admin/pages',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({slug,title:'Title',body:'Body'})},{DATABASE:db,AUTH_SECRET:secret});
  assert.equal((await create('first')).status,201);
  assert.equal((await create('first')).status,409);
  db.sqlite.exec("CREATE TRIGGER reject_page BEFORE INSERT ON content_pages BEGIN SELECT RAISE(ABORT,'simulated database failure'); END");
  assert.equal((await create('second')).status,500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM content_pages').get().n,1);
  db.sqlite.close();
});

for (const resource of ["announcements", "pages"]) {
  test(`${resource} rejects malformed input without changing published content`, async () => {
    const db = createDatabase();
    db.sqlite.exec("INSERT INTO user (id, name, email, password, isAdmin, emailVerified) VALUES ('admin', 'Admin', 'admin@example.test', '', 1, 1)");
    const request = (method, suffix, body) => app.request(`/api/content/admin/${resource}${suffix}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body }, { DATABASE: db, AUTH_SECRET: secret });
    const valid = { title: "Title", body: "Body", published: false, ...(resource === "pages" ? { slug: "test-page" } : {}) };
    try {
      const created = await request("POST", "", JSON.stringify(valid));
      assert.equal(created.status, 201);
      const key = resource === "pages" ? "page" : "announcement";
      const original = (await created.json())[key];
      const invalid = ["{", "null", "[]", '"text"', "3", ...[
        { title: 3 }, { title: null }, { title: " " }, { title: "x".repeat(161) },
        { body: 3 }, { body: null }, { body: " " }, { body: "x".repeat(resource === "pages" ? 50001 : 20001) },
        { published: "false" }, { published: 0 }, { published: null },
        ...(resource === "pages" ? [{ slug: 3 }, { slug: null }, { slug: " " }, { slug: "bad/slug" }] : []),
      ].map((patch) => JSON.stringify({ ...valid, ...patch }))];
      for (const method of ["POST", "PUT"]) {
        for (const body of invalid) {
          const response = await request(method, method === "PUT" ? `/${original.id}` : "", body);
          assert.equal(response.status, 400, `${method}: ${body.slice(0, 100)}`);
        }
      }
      const unchanged = await app.request(`/api/content/admin/${resource}`, { headers: { Authorization: `Bearer ${token}` } }, { DATABASE: db, AUTH_SECRET: secret });
      assert.deepEqual((await unchanged.json())[resource], [original]);
      const published = await request("PUT", `/${original.id}`, JSON.stringify({ published: true }));
      assert.equal(published.status, 200);
      const row = (await published.json())[key];
      assert.equal(row.title, valid.title);
      assert.equal(row.body, valid.body);
      assert.equal(row.published, true);
      const draft = await request("PUT", `/${original.id}`, JSON.stringify({ published: false }));
      assert.equal(draft.status, 200);
      assert.equal((await draft.json())[key].published, false);
    } finally { db.sqlite.close(); }
  });
}
