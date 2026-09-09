import assert from "node:assert/strict";
import test from "node:test";
import { D1Adapter } from "./store-harness.mjs";
import { applyLocalMigrations } from "../scripts/local-migrations.mjs";

test("账户版本迁移保留旧账户、失败可重试、重复启动不重置版本", async () => {
  const database = new D1Adapter();
  await database.prepare(`CREATE TABLE npd_users (
    id TEXT PRIMARY KEY, auth_user_id TEXT UNIQUE, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    department TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    bootstrap_admin INTEGER NOT NULL DEFAULT 0, password_salt TEXT, password_hash TEXT, last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await database.prepare(`INSERT INTO npd_users(id,email,name,department,role,bootstrap_admin,password_salt,password_hash)
    VALUES ('legacy','legacy@example.test','既有管理员','管理部','admin',1,'synthetic-salt','synthetic-hash')`).run();
  const before = await database.prepare("SELECT * FROM npd_users").first();
  database.failNextBatchMatching = /ADD `version`/;
  await assert.rejects(() => applyLocalMigrations(database), /Injected/);
  assert.deepEqual(await database.prepare("SELECT * FROM npd_users").first(), before);
  assert.equal(await database.prepare("SELECT name FROM __npd_local_migrations WHERE name='0006_slimy_gamma_corps'").first(), null);
  await applyLocalMigrations(database);
  const { version, ...after } = await database.prepare("SELECT * FROM npd_users").first();
  assert.deepEqual({ ...before }, after);
  assert.equal(version, 1);
  await database.prepare("UPDATE npd_users SET version=3 WHERE id='legacy'").run();
  await applyLocalMigrations(database);
  assert.equal((await database.prepare("SELECT version FROM npd_users").first()).version, 3);
  assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
});
