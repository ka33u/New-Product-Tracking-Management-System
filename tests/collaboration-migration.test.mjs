import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { D1Adapter } from "./store-harness.mjs";
import { applyLocalMigrations } from "../scripts/local-migrations.mjs";

test("成员与订单增量版本迁移保留旧数据、失败原子回退且重启不重置", async () => {
  const db = new D1Adapter();
  for (const table of ["npd_users", "npd_customers", "npd_projects"]) await db.prepare(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`).run();
  for (const table of ["npd_users", "npd_customers", "npd_projects"]) await db.prepare(`INSERT INTO ${table} VALUES ('legacy')`).run();
  const migration = (await readFile(new URL("../drizzle/0007_abandoned_mandarin.sql", import.meta.url), "utf8")).split("--> statement-breakpoint");
  await db.batch(migration.slice(0, 2).map((sql) => db.prepare(sql)));
  await db.prepare("INSERT INTO npd_project_members(id,project_id,user_id,responsibility) VALUES ('member','legacy','legacy','既有职责')").run();
  await db.prepare(`INSERT INTO npd_sales_orders(id,order_no,customer_id,project_id,product_summary,quantity,amount,order_date,delivery_date,created_by)
    VALUES ('order','LEGACY','legacy','legacy','既有电机',2,123.45,'2026-01-01','2026-12-31','legacy')`).run();
  const member = await db.prepare("SELECT * FROM npd_project_members").first();
  const order = await db.prepare("SELECT * FROM npd_sales_orders").first();
  db.failNextBatchMatching = /ALTER TABLE `npd_sales_orders` ADD/;
  await assert.rejects(() => applyLocalMigrations(db), /Injected/);
  assert.deepEqual(await db.prepare("SELECT * FROM npd_project_members").first(), member);
  assert.deepEqual(await db.prepare("SELECT * FROM npd_sales_orders").first(), order);
  assert.equal(await db.prepare("SELECT name FROM __npd_local_migrations WHERE name='0007_abandoned_mandarin'").first(), null);
  await applyLocalMigrations(db);
  for (const [table, before] of [["npd_project_members", member], ["npd_sales_orders", order]]) {
    const { version, ...after } = await db.prepare(`SELECT * FROM ${table}`).first();
    assert.deepEqual(after, { ...before }); assert.equal(version, 1);
    await db.prepare(`UPDATE ${table} SET version=5`).run();
  }
  await applyLocalMigrations(db);
  assert.equal((await db.prepare("SELECT version FROM npd_sales_orders").first()).version, 5);
  assert.equal((await db.prepare("SELECT version FROM npd_project_members").first()).version, 5);
  assert.equal((await db.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
});
