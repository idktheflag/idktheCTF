import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

test("a crafted bounded-repeat flag cannot stall the Worker submission handler", () => {
  const script = `
    import assert from "node:assert/strict";
    import { sign } from "hono/jwt";
    const {createDatabase,loadWorker}=await import(${JSON.stringify(new URL("./helpers.mjs", import.meta.url).href)});
    const app=await loadWorker(), db=createDatabase();
    db.sqlite.exec("INSERT INTO user(id,name,email,password,emailVerified) VALUES ('player','Player','player@example.test','',1); INSERT INTO teams(id,name,join_code,captain_id) VALUES ('team','Team','CODE','player'); INSERT INTO team_members(id,team_id,user_id) VALUES ('member','team','player'); INSERT INTO challenges(id,name,description,url,points,category,author,flag) VALUES ('challenge','Challenge','Description','',100,'web','Admin',''); INSERT INTO challenge_flags(id,challenge_id,value,type) VALUES ('regex','challenge','^a{0,64}a{0,64}a{0,64}a{0,64}a{0,64}$','regex')");
    const secret='test-regex-secret';
    const token=await sign({userId:'player',username:'Player',isAdmin:false,emailVerified:true,authVersion:0,exp:Math.floor(Date.now()/1000)+60},secret);
    const response=await app.request('/api/challenges/submit/challenge',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({flag:'a'.repeat(250)+'!'})},{DATABASE:db,AUTH_SECRET:secret});
    assert.equal(response.status,200);assert.equal((await response.json()).submission.isCorrect,false);db.sqlite.close();
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 2500, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.error?.code || ""} ${result.stderr}`);
});

test("linear matching preserves ordinary case-insensitive, anchored and unanchored flags", async () => {
  const built = await build({ entryPoints: [fileURLToPath(new URL("../src/utils/flag-regex.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser" });
  const { compileFlagRegex } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
  for (const [pattern, input, expected] of [
    ["^flag\\{[a-z0-9]+\\}$", "FLAG{abc123}", true],
    ["^flag\\{[a-z0-9]+\\}$", "prefix flag{abc123}", false],
    ["flag", "prefix FLAG suffix", true],
    ["^flag\\{hello world\\}$", "flag{hello world}", true],
    ["^\\u0066lag\\{\\d{2}\\}$", "flag{42}", true],
  ]) {
    const regex = compileFlagRegex(pattern);
    assert.ok(regex, pattern);
    assert.equal(regex.test(input), expected, pattern);
  }
  assert.equal(compileFlagRegex("(?<=flag)secret"), null);
  assert.equal(compileFlagRegex("(flag)\\1"), null);
});
