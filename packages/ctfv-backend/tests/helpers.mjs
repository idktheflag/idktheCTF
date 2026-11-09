import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export async function loadWorker() {
  const compiled = await build({ entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/package.json");' } });
  return (await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`)).default;
}

export function createDatabase(beforeMigration = () => {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    beforeMigration(file, sqlite);
    sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const prepare = (sql, values = []) => ({
    bind: (...args) => prepare(sql, args),
    async first(column) { const row = sqlite.prepare(sql).get(...values) ?? null; return column && row ? row[column] : row; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...values), meta: {} }; },
    async raw() { const statement = sqlite.prepare(sql); statement.setReturnArrays(true); return statement.all(...values); },
    async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }; },
    sql, values,
  });
  return {
    sqlite,
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          const prepared = sqlite.prepare(statement.sql);
          if (prepared.columns().length) { results.push({ success: true, results: prepared.all(...statement.values), meta: {} }); }
          else { results.push(await statement.run()); }
        }
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
}
