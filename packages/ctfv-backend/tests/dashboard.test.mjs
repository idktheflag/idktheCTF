import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createDatabase } from "./helpers.mjs";
const source = readFileSync(new URL("../src/routes/admin.ts", import.meta.url), "utf8");
const recentQuery = source.match(/prepare\("(SELECT s\.id, s\.timestamp[^"\n]+LIMIT 10)"\)/)[1];

test("dashboard recent submissions use an index instead of sorting the entire attempt history", () => {
  const db = createDatabase();
  const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${recentQuery}`).all().map((row) => row.detail).join("\n");
  assert.match(plan, /USING INDEX submissions_timestamp_idx/);
  assert.doesNotMatch(plan, /USE TEMP B-TREE FOR ORDER BY/);
  db.sqlite.close();
});
