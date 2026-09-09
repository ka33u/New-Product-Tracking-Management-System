import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { D1Adapter } from "./store-harness.mjs";
import { applyLocalMigrations, localMigrationNames } from "../scripts/local-migrations.mjs";

test("整机生产迁移原样保留旧记录、不虚构确认、故障原子回退并可重复启动", async () => {
  const db = new D1Adapter();
  await db.prepare("CREATE TABLE npd_customers(id TEXT PRIMARY KEY)").run();
  await db.prepare("CREATE TABLE __npd_local_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT DEFAULT CURRENT_TIMESTAMP)").run();
  for (const name of localMigrationNames.filter((name) => name !== "0010_plain_lake")) {
    const sql = await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    await db.batch([...sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)),
      db.prepare("INSERT INTO __npd_local_migrations(name,checksum) VALUES (?,?)").bind(name, createHash("sha256").update(sql).digest("hex"))]);
  }
  const delta = await readFile(new URL("../drizzle/0010_plain_lake.sql", import.meta.url), "utf8");
  await db.prepare(delta.split("--> statement-breakpoint")[0]).run();
  await db.prepare("INSERT INTO npd_customers VALUES ('c')").run();
  await db.prepare("INSERT INTO npd_users(id,email,name,department,role) VALUES ('u','legacy@example.test','原生产','生产','production')").run();
  await db.prepare("INSERT INTO npd_projects(id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,planned_start,planned_end) VALUES ('p','OLD','旧项目','旧系列','电机','研发','c','u','u','2026-01-01','2027-01-01')").run();
  await db.prepare("INSERT INTO npd_project_motors(id,project_id,model,planned_date,actual_date,status,design_revision) VALUES ('m','p','旧规格','2026-07-01','2026-06-30','completed',7)").run();
  const before = await db.prepare("SELECT * FROM npd_project_motors").first();
  db.failNextBatchMatching = /INSERT INTO __npd_local_migrations/;
  await assert.rejects(() => applyLocalMigrations(db), /Injected/);
  assert.deepEqual(await db.prepare("SELECT * FROM npd_project_motors").first(), before);
  await applyLocalMigrations(db);
  const { confirmed_by, confirmed_at, production_note, ...after } = await db.prepare("SELECT * FROM npd_project_motors").first();
  assert.deepEqual(after, { ...before }); assert.equal(confirmed_by, null); assert.equal(confirmed_at, null); assert.equal(production_note, "");
  await assert.rejects(() => db.prepare("UPDATE npd_project_motors SET confirmed_by='missing'").run(), /FOREIGN KEY/);
  await db.prepare("UPDATE npd_project_motors SET confirmed_by='u',confirmed_at=CURRENT_TIMESTAMP,production_note='复核'").run();
  const saved = await db.prepare("SELECT * FROM npd_project_motors").first();
  await applyLocalMigrations(db);
  assert.deepEqual(await db.prepare("SELECT * FROM npd_project_motors").first(), saved);
  assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
});
