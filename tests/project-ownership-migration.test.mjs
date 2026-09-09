import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";
import { D1Adapter } from "./store-harness.mjs";
import { applyLocalMigrations } from "../scripts/local-migrations.mjs";

test("交接版本迁移保留项目与状态版次、失败可重试且重启不重置", async () => {
  const db = new D1Adapter();
  await db.prepare("CREATE TABLE npd_customers(id TEXT PRIMARY KEY)").run();
  await db.prepare("CREATE TABLE __npd_local_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
  for (const name of ["0005_new_quasimodo", "0006_slimy_gamma_corps", "0007_abandoned_mandarin", "0008_fuzzy_gressill"]) {
    const sql = await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    await db.batch([...sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)),
      db.prepare("INSERT INTO __npd_local_migrations(name,checksum) VALUES (?,?)").bind(name, createHash("sha256").update(sql).digest("hex"))]);
  }
  await db.prepare("INSERT INTO npd_customers VALUES ('customer')").run();
  await db.prepare("INSERT INTO npd_users(id,email,name,department,role) VALUES ('owner','legacy@example.test','原负责人','设计','design')").run();
  await db.prepare(`INSERT INTO npd_projects(id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,planned_start,planned_end,status,lifecycle_version)
    VALUES ('legacy','LEGACY','旧项目','旧系列','电机','研发','customer','owner','owner','2026-01-01','2027-01-01','paused',7)`).run();
  const before = await db.prepare("SELECT * FROM npd_projects").first();
  db.failNextBatchMatching = /INSERT INTO __npd_local_migrations/;
  await assert.rejects(() => applyLocalMigrations(db), /Injected/);
  assert.deepEqual(await db.prepare("SELECT * FROM npd_projects").first(), before);
  assert.equal(await db.prepare("SELECT name FROM __npd_local_migrations WHERE name='0009_brave_cloak'").first(), null);
  await applyLocalMigrations(db);
  const { ownership_version, ...after } = await db.prepare("SELECT * FROM npd_projects").first();
  assert.deepEqual(after, { ...before }); assert.equal(ownership_version, 1);
  await db.prepare("UPDATE npd_projects SET ownership_version=4").run();
  await applyLocalMigrations(db);
  assert.equal((await db.prepare("SELECT ownership_version FROM npd_projects").first()).ownership_version, 4);
  assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
});
