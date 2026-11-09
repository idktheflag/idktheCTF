import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createDatabase} from './helpers.mjs';
test('per-team rate counting uses a covering index for both team and timestamp',()=>{
  const db=createDatabase();
  const plan=db.sqlite.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) AS total FROM submissions WHERE teamId = ? AND timestamp >= ?').all('team',1000).map(r=>r.detail).join('\n');
  assert.match(plan,/COVERING INDEX submissions_team_timestamp_idx/);
  assert.match(plan,/timestamp>\?/);
  db.sqlite.close();
});
