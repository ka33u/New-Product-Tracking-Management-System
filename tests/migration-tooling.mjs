import assert from "node:assert/strict";
import { mkdtemp, cp, readFile, writeFile, readdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { DatabaseSync } from "node:sqlite";

// All generated config/schema/SQL is in a fresh temporary directory. No D1,
// R2, production configuration, or real data is opened by this test.
const root = path.resolve(process.argv[2] || fileURLToPath(new URL("../", import.meta.url)));
const expectedVersion = process.argv[3] || "0.25.12";
const require = createRequire(path.join(root, "package.json"));
const helperPath = require.resolve("@esbuild-kit/core-utils");
const compiler = createRequire(helperPath)("esbuild");
assert.equal(compiler.version, expectedVersion, "the helper's actual resolved compiler must match the evaluated version");
const helper = require(helperPath);
for (const transform of [helper.transformSync, helper.transform]) {
  const file = path.join(tmpdir(), "hengda-tooling-sample.ts");
  const result = await transform("export const total: number = 2 + 3;", file, { format: "cjs" });
  const module = { exports: {} };
  runInNewContext(result.code, { module, exports: module.exports, __filename: file, __dirname: path.dirname(file) }, { timeout: 1000 });
  assert.equal(module.exports.total, 5);
  const map = typeof result.map === "string" ? JSON.parse(result.map) : result.map;
  assert.equal(map.version, 3); assert.ok(map.sources.length);
}

async function inventory(directory, prefix = "") {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await inventory(path.join(directory, entry.name), name + "/"));
    else { assert.ok(entry.isFile()); result[name] = createHash("sha256").update(await readFile(path.join(directory, entry.name))).digest("hex"); }
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
const original = await inventory(path.join(root, "drizzle"));
const temp = await mkdtemp(path.join(tmpdir(), "hengda-migration-tooling-"));
const db = new DatabaseSync(":memory:");
try {
  const out = path.join(temp, "drizzle");
  await cp(path.join(root, "drizzle"), out, { recursive: true });
  await symlink(path.join(root, "node_modules"), path.join(temp, "node_modules"), "dir");
  const schemaFile = path.join(temp, "schema.ts");
  const schema = await readFile(path.join(root, "db/schema.ts"), "utf8");
  await writeFile(schemaFile, schema);
  const configFile = path.join(temp, "drizzle.config.ts");
  // Drizzle Kit 0.31 expects a relative output path; mirror the project's
  // supported configuration, with the child rooted in this isolated folder.
  await writeFile(configFile, `const config: { dialect: "sqlite"; schema: string; out: string } = ${JSON.stringify({ dialect: "sqlite", schema: "./schema.ts", out: "./drizzle" })}; export default config;`);
  const generate = () => {
    const result = spawnSync(process.execPath, [path.join(root, "node_modules/drizzle-kit/bin.cjs"), "generate", "--config", configFile, "--name", "tooling_probe"],
      { cwd: temp, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // Some tooling errors are printed to stderr despite an exit status of 0.
    // Require the actual success text as well as the process status below.
    return result.stdout + result.stderr;
  };
  assert.match(generate(), /No schema changes/);
  assert.deepEqual(await inventory(out), original, "unchanged schema must preserve all historical SQL and metadata bytes");
  // Build a synthetic historical SQLite database; this is not the local server's
  // bootstrap or a request to replay legacy migrations against existing data.
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of Object.keys(original).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) db.exec(await readFile(path.join(out, name), "utf8"));
  db.exec("INSERT INTO npd_users(id,email,name,department,role) VALUES ('u','migration@example.invalid','合成人员','测试','design')");
  db.exec("INSERT INTO npd_customers(id,code,name,industry) VALUES ('c','TEST','合成客户','测试')");
  db.exec("INSERT INTO npd_projects(id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,planned_start,planned_end) VALUES ('p','TEST','合成项目','系列','测试','测试','c','u','u','2026-01-01','2026-12-31')");
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  const before = new Map(tables.map((name) => [name, db.prepare(`SELECT * FROM "${name}"`).all()]));
  const anchor = 'export const npdProjects = sqliteTable("npd_projects", {';
  assert.equal(schema.split(anchor).length, 2);
  await writeFile(schemaFile, schema.replace(anchor, anchor + '\n  toolingProbe: integer("tooling_probe").notNull().default(0),'));
  generate();
  const after = await inventory(out);
  for (const [name, hash] of Object.entries(original)) if (name !== "meta/_journal.json") assert.equal(after[name], hash, `historical file changed: ${name}`);
  const added = Object.keys(after).filter((name) => !original[name] && name.endsWith(".sql"));
  assert.equal(added.length, 1);
  const sql = (await readFile(path.join(out, added[0]), "utf8")).trim();
  assert.equal(sql, 'ALTER TABLE `npd_projects` ADD `tooling_probe` integer DEFAULT 0 NOT NULL;');
  const oldJournal = JSON.parse(await readFile(path.join(root, "drizzle/meta/_journal.json"), "utf8"));
  const newJournal = JSON.parse(await readFile(path.join(out, "meta/_journal.json"), "utf8"));
  assert.deepEqual(newJournal.entries.slice(0, -1), oldJournal.entries);
  assert.equal(newJournal.entries.length, oldJournal.entries.length + 1);
  db.exec(sql);
  for (const [name, rows] of before) {
    const actual = db.prepare(`SELECT * FROM "${name}"`).all();
    if (name === "npd_projects") for (const row of actual) { assert.equal(row.tooling_probe, 0); delete row.tooling_probe; }
    assert.deepEqual(actual, rows, `${name}: historical values must survive`);
  }
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.match(generate(), /No schema changes/);
  assert.deepEqual(await inventory(out), after, "rerunning generation must not append another migration");
  assert.deepEqual(await inventory(path.join(root, "drizzle")), original, "real migration sources must remain untouched");
  console.log(`迁移工具兼容通过：esbuild ${compiler.version}、同步/异步TypeScript转换、${tables.length}表当前结构无变更、合成增量SQL及历史数据保留、重复生成无变化。`);
} finally {
  db.close(); await rm(temp, { recursive: true, force: true });
}
