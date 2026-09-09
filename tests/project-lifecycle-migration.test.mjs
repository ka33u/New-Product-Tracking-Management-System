import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { D1Adapter } from "./store-harness.mjs";
import { applyLocalMigrations } from "../scripts/local-migrations.mjs";

test("项目状态版本迁移保留旧字段、失败回退重试、重启不重置", async () => {
  const db = new D1Adapter();
  await db.prepare("CREATE TABLE npd_users (id TEXT PRIMARY KEY)").run();
  await db.prepare("CREATE TABLE npd_customers (id TEXT PRIMARY KEY)").run();
  await db.prepare("INSERT INTO npd_users VALUES ('legacy')").run();
  await db.prepare("INSERT INTO npd_customers VALUES ('legacy')").run();
  const sql = await readFile(new URL("../drizzle/0008_fuzzy_gressill.sql", import.meta.url), "utf8");
  await db.prepare(sql.split("--> statement-breakpoint")[0]).run();
  await db.prepare(`INSERT INTO npd_projects (id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,status,planned_start,planned_end)
    VALUES ('legacy','LEGACY','旧项目','旧系列','电机','研发','legacy','legacy','legacy','paused','2026-01-01','2027-01-01')`).run();
  const before = await db.prepare("SELECT * FROM npd_projects").first();
  await assert.rejects(() => db.prepare(`INSERT INTO npd_projects (id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,status,planned_start,planned_end)
    VALUES ('duplicate','LEGACY','重复编号','旧系列','电机','研发','legacy','legacy','legacy','active','2026-01-01','2027-01-01')`).run(), /UNIQUE/);
  db.failNextBatchMatching = /INSERT INTO __npd_local_migrations/;
  // Apply preceding migrations first so the injected failure exercises 0008.
  const { createHash } = await import("node:crypto");
  await db.prepare("CREATE TABLE __npd_local_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
  for (const name of ["0005_new_quasimodo", "0006_slimy_gamma_corps", "0007_abandoned_mandarin"]) {
    const previous = await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    await db.batch(previous.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
    await db.prepare("INSERT INTO __npd_local_migrations(name,checksum) VALUES (?,?)").bind(name, createHash("sha256").update(previous).digest("hex")).run();
  }
  await assert.rejects(() => applyLocalMigrations(db), /Injected/);
  assert.deepEqual(await db.prepare("SELECT * FROM npd_projects").first(), before);
  assert.equal(await db.prepare("SELECT name FROM __npd_local_migrations WHERE name='0008_fuzzy_gressill'").first(), null);
  await applyLocalMigrations(db);
  const { lifecycle_version, ownership_version, ...after } = await db.prepare("SELECT * FROM npd_projects").first();
  assert.equal(ownership_version, 1);
  assert.deepEqual(after, { ...before }); assert.equal(lifecycle_version, 1);
  await db.prepare("UPDATE npd_projects SET lifecycle_version=7").run();
  await applyLocalMigrations(db);
  assert.equal((await db.prepare("SELECT lifecycle_version FROM npd_projects").first()).lifecycle_version, 7);
  assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
});
