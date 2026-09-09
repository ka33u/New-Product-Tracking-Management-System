import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Miniflare } from "miniflare";
import { createBackup, restoreBackup } from "../scripts/local-backup.mjs";
import { applyLocalMigrations } from "../scripts/local-migrations.mjs";

const root = await mkdtemp(path.join(tmpdir(), "hengda-runtime-recovery-"));
const stateRoot = path.join(root, "source");
const options = (state) => ({
  modules: true, script: "export default {fetch(){return new Response('recovery test')}}",
  compatibilityDate: "2026-05-22", port: 0,
  d1Databases: { DB: "recovery-database" }, d1Persist: path.join(state, "d1"),
  r2Buckets: { FILES: "recovery-files" }, r2Persist: path.join(state, "r2"),
});
const bytes = new TextEncoder().encode("亨达整机检验附件：恢复后内容应完整一致。\n");
const source = new Miniflare(options(stateRoot));
try {
  const database = await source.getD1Database("DB");
  await applyLocalMigrations(database);
  const bucket = await source.getR2Bucket("FILES");
  await database.batch([
    database.prepare("CREATE TABLE npd_customers(id TEXT PRIMARY KEY)"),
    database.prepare("CREATE TABLE npd_project_sheets(id TEXT PRIMARY KEY,project_id TEXT REFERENCES npd_projects(id))"),
    database.prepare("CREATE TABLE npd_documents(id TEXT PRIMARY KEY,object_key TEXT,size INTEGER)"),
    database.prepare("CREATE TABLE npd_local_sessions(id TEXT PRIMARY KEY,user_id TEXT REFERENCES npd_users(id))"),
    database.prepare("INSERT INTO npd_users(id,email,name,department,role) VALUES ('admin','restore@example.test','恢复演练管理员','测试','admin')"),
    database.prepare("INSERT INTO npd_customers VALUES ('customer')"),
    database.prepare(`INSERT INTO npd_projects(id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,planned_start,planned_end,lifecycle_version)
      VALUES ('project','RESTORE','恢复项目','测试','电机','研发','customer','admin','admin','2026-01-01','2027-01-01',7)`),
    database.prepare("INSERT INTO npd_project_sheets VALUES ('sheet','project')"),
    database.prepare("INSERT INTO npd_documents VALUES ('attachment','npd/project/inspection/report.txt',?)").bind(bytes.length),
    database.prepare("INSERT INTO npd_local_sessions VALUES ('old-session','admin')"),
    database.prepare("INSERT INTO npd_local_login_limits VALUES ('restore-limit',unixepoch(),8)"),
  ]);
  await bucket.put("npd/project/inspection/report.txt", bytes, { httpMetadata: { contentType: "text/plain" } });
} finally { await source.dispose(); }

const backup = await createBackup({ stateRoot, backupRoot: path.join(root, "backups") });
const restored = await restoreBackup({ directory: backup.directory, destination: path.join(root, "restored") });
const target = new Miniflare(options(restored.directory));
try {
  const database = await target.getD1Database("DB");
  await applyLocalMigrations(database);
  assert.equal((await database.prepare("SELECT name FROM npd_users").first()).name, "恢复演练管理员");
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_projects").first()).n, 1);
  assert.equal((await database.prepare("SELECT lifecycle_version FROM npd_projects").first()).lifecycle_version, 7);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_local_sessions").first()).n, 0);
  assert.equal((await database.prepare("SELECT attempt_count FROM npd_local_login_limits WHERE bucket='restore-limit'").first()).attempt_count, 8);
  const document = await database.prepare("SELECT object_key,size FROM npd_documents").first();
  const bucket = await target.getR2Bucket("FILES");
  const object = await bucket.get(document.object_key);
  assert.ok(object, "恢复后必须能够通过 R2 API 找到附件");
  assert.equal(object.size, document.size);
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), bytes);
  console.log("真实 D1/R2 恢复演练通过：项目、人员、附件逐字节一致，旧会话已撤销，新增迁移及限速记录保留。");
} finally { await target.dispose(); }
