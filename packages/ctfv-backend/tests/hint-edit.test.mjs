import assert from "node:assert/strict";
import { test } from "node:test";
import { sign } from "hono/jwt";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/d1";
import { createDatabase, loadWorker } from "./helpers.mjs";

const app = await loadWorker();
const secret = "hint-edit-test-secret-with-at-least-32-characters";
function fixture() {
  const db = createDatabase();
  db.sqlite.exec("INSERT INTO user(id,name,email,password,isAdmin,emailVerified) VALUES ('admin','Admin','admin@example.test','',1,1); INSERT INTO teams(id,name,join_code,captain_id) VALUES ('team','Team','code','admin'); INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('challenge','Challenge','Description','',100,'web','Admin','flag'); INSERT INTO challenge_hints(id,challenge_id,body,cost,sort_order) VALUES ('first','challenge','First hint',10,0),('second','challenge','Second hint',20,1); INSERT INTO hint_unlocks(id,hint_id,team_id,unlocked_at) VALUES ('purchase','first','team',1000)");
  return db;
}

test("ordinary challenge edits preserve purchased hint IDs and score deductions", async () => {
  const db = fixture();
  try {
    const token = await sign({ userId: "admin", isAdmin: true, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, secret, "HS256");
    const response = await app.request("/api/challenges/update/challenge", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ description: "Edited description", hints: [{ body: "First hint", cost: 10 }, { body: "Second hint", cost: 20 }] }) }, { DATABASE: db, AUTH_SECRET: secret });
    assert.equal(response.status, 200);
    assert.equal(db.sqlite.prepare("SELECT hint_id FROM hint_unlocks WHERE id='purchase'").get()?.hint_id, "first");
    assert.equal(db.sqlite.prepare("SELECT SUM(h.cost) AS cost FROM hint_unlocks u JOIN challenge_hints h ON h.id=u.hint_id").get().cost, 10);
  } finally { db.sqlite.close(); }
});

test("hint-only and tag-only updates do not require unrelated challenge fields", async () => {
  const db = fixture();
  try {
    const token = await sign({ userId: "admin", isAdmin: true, emailVerified: true, authVersion: 0, exp: Math.floor(Date.now()/1000)+60 }, secret, "HS256");
    const env = { DATABASE: db, AUTH_SECRET: secret };
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    for (const input of [{ hints: [{ id: "first", body: "Edited first", cost: 10 }, { id: "second", body: "Second hint", cost: 20 }] }, { tags: ["updated"] }]) {
      const response = await app.request("/api/challenges/update/challenge", { method: "PUT", headers, body: JSON.stringify(input) }, env);
      assert.equal(response.status, 200);
    }
    assert.equal(db.sqlite.prepare("SELECT hint_id FROM hint_unlocks WHERE id='purchase'").get().hint_id, "first");
    assert.equal(db.sqlite.prepare("SELECT tag FROM challenge_tags").get().tag, "updated");
  } finally { db.sqlite.close(); }
});

async function helper() {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL("../src/utils/challenge-hints.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node" });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
}

test("hint reconciliation retains purchases through reorder, body/cost edits, insert and removal", async () => {
  const { buildHintReconciliation } = await helper();
  const db = fixture();
  const orm = drizzle(db);
  const reconcile = async (hints) => { const statements = await buildHintReconciliation(orm, "challenge", hints); if (statements.length) await orm.batch(statements); };
  const rows = () => db.sqlite.prepare("SELECT id,body,cost,sort_order FROM challenge_hints ORDER BY sort_order").all();
  try {
    await reconcile([{ body: "Second hint", cost: 20 }, { body: "First hint", cost: 10 }, { body: "New hint", cost: 0 }]);
    assert.deepEqual(rows().map((row) => row.id).slice(0, 2), ["second", "first"]);
    const inserted = rows()[2].id;
    assert.ok(!["first", "second"].includes(inserted));
    await reconcile([{ id: "second", body: "Second hint", cost: 21 }, { id: "first", body: "Edited first hint", cost: 15 }, { id: inserted, body: "New hint", cost: 0 }]);
    assert.deepEqual(rows().map((row) => row.id), ["second", "first", inserted]);
    assert.equal(db.sqlite.prepare("SELECT hint_id FROM hint_unlocks WHERE id='purchase'").get().hint_id, "first");
    await reconcile([{ id: "first", body: "Explicitly edited", cost: 15 }]);
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].id, "first");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM hint_unlocks").get().n, 1);
    await reconcile([]);
    assert.deepEqual(rows(), []);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM hint_unlocks").get().n, 0);
  } finally { db.sqlite.close(); }
});

test("hint reconciliation rejects unknown or duplicate supplied IDs before mutations", async () => {
  const { buildHintReconciliation, HintInputError } = await helper();
  const db = fixture();
  try {
    for (const hints of [[{ id: "other-challenge-hint", body: "x", cost: 1 }], [{ id: "first", body: "x", cost: 1 }, { id: "first", body: "y", cost: 1 }], [{ id: 7, body: "x", cost: 1 }]]) {
      await assert.rejects(buildHintReconciliation(drizzle(db), "challenge", hints), HintInputError);
    }
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM challenge_hints").get().n, 2);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM hint_unlocks").get().n, 1);
  } finally { db.sqlite.close(); }
});

test("hint reconciliation reserves explicit IDs and prefers body plus cost for duplicate text", async () => {
  const { buildHintReconciliation } = await helper();
  const db = fixture();
  const orm = drizzle(db);
  const reconcile = async (hints) => orm.batch(await buildHintReconciliation(orm, "challenge", hints));
  try {
    db.sqlite.exec("UPDATE challenge_hints SET body='Shared hint'");
    await reconcile([{ body: "Shared hint", cost: 20 }, { body: "Shared hint", cost: 10 }]);
    assert.deepEqual(db.sqlite.prepare("SELECT id FROM challenge_hints ORDER BY sort_order").all().map((row) => row.id), ["second", "first"]);
    await reconcile([{ body: "Shared hint", cost: 20 }, { id: "first", body: "Explicit edit", cost: 15 }]);
    assert.deepEqual(db.sqlite.prepare("SELECT id FROM challenge_hints ORDER BY sort_order").all().map((row) => row.id), ["second", "first"]);
    assert.equal(db.sqlite.prepare("SELECT hint_id FROM hint_unlocks WHERE id='purchase'").get().hint_id, "first");
  } finally { db.sqlite.close(); }
});


test("removing purchased A and editing B never transfers A purchases", async () => {
  const { buildHintReconciliation } = await helper();
  const db = fixture();
  try {
    const orm = drizzle(db);
    await orm.batch(await buildHintReconciliation(orm, "challenge", [{ id: "second", body: "Edited second hint", cost: 25 }]));
    assert.deepEqual(db.sqlite.prepare("SELECT id FROM challenge_hints").all().map((row) => row.id), ["second"]);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM hint_unlocks").get().n, 0);
  } finally { db.sqlite.close(); }
});

test("explicit new hints never reuse removed IDs even with identical content", async () => {
  const { buildHintReconciliation } = await helper();
  const db = fixture();
  try {
    const orm = drizzle(db);
    await orm.batch(await buildHintReconciliation(orm, "challenge", [{ id: null, body: "First hint", cost: 10 }, { id: "second", body: "Second hint", cost: 20 }]));
    const inserted = db.sqlite.prepare("SELECT id FROM challenge_hints WHERE body='First hint'").get().id;
    assert.ok(inserted !== "first" && inserted !== "second");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM hint_unlocks").get().n, 0);
  } finally { db.sqlite.close(); }
});

test("ambiguous legacy mutation rejects before deleting purchases", async () => {
  const { buildHintReconciliation, HintInputError } = await helper();
  const db = fixture();
  try {
    for (const hints of [[{ body: "Edited second hint", cost: 20 }], [{ body: "First hint", cost: 11 }, { body: "Second hint", cost: 20 }]]) {
      await assert.rejects(buildHintReconciliation(drizzle(db), "challenge", hints), HintInputError);
    }
    assert.equal(db.sqlite.prepare("SELECT hint_id FROM hint_unlocks WHERE id='purchase'").get().hint_id, "first");
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM challenge_hints").get().n, 2);
  } finally { db.sqlite.close(); }
});
