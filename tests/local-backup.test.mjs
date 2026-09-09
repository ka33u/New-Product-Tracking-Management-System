import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, readFile, cp, symlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBackup, restoreBackup, verifyBackup } from "../scripts/local-backup.mjs";

test("offline backup verifies data, refuses overwrites/tampering and revokes restored sessions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hengda-backup-test-"));
  const stateRoot = path.join(root, "source");
  const databasePath = path.join(stateRoot, "d1", "app.sqlite");
  await mkdir(path.dirname(databasePath), { recursive: true });
  await mkdir(path.join(stateRoot, "r2", "blobs"), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE npd_users (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE npd_projects (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES npd_users(id));
    CREATE TABLE npd_project_sheets (id TEXT PRIMARY KEY, project_id TEXT REFERENCES npd_projects(id));
    CREATE TABLE npd_documents (id TEXT PRIMARY KEY, project_id TEXT REFERENCES npd_projects(id));
    CREATE TABLE npd_local_sessions (id TEXT PRIMARY KEY, user_id TEXT REFERENCES npd_users(id));
    INSERT INTO npd_users VALUES ('u1','测试管理员');
    INSERT INTO npd_projects VALUES ('p1','u1');
    INSERT INTO npd_project_sheets VALUES ('s1','p1');
    INSERT INTO npd_documents VALUES ('d1','p1');
    INSERT INTO npd_local_sessions VALUES ('session1','u1');
  `);
  await writeFile(path.join(stateRoot, "r2/blobs/report.bin"), Buffer.from([0, 128, 255, 10]));
  await assert.rejects(() => createBackup({ stateRoot, backupRoot: path.join(root, "live") }), /数据库正在使用/);
  database.close();
  const backup = await createBackup({ stateRoot, backupRoot: path.join(root, "backups") });
  assert.equal(backup.counts.npd_projects, 1);
  assert.equal((await stat(backup.directory)).mode & 0o777, 0o700);
  const verified = await verifyBackup(backup.directory);
  assert.equal(verified.manifest.files.length, 2);
  const restored = await restoreBackup({ directory: backup.directory, destination: path.join(root, "restored") });
  assert.equal(restored.revokedSessions, 1);
  const restoredDb = new DatabaseSync(path.join(restored.directory, "d1/app.sqlite"));
  assert.equal(restoredDb.prepare("SELECT name FROM npd_users").get().name, "测试管理员");
  assert.equal(restoredDb.prepare("SELECT count(*) AS n FROM npd_local_sessions").get().n, 0);
  restoredDb.close();
  assert.deepEqual(await readFile(path.join(restored.directory, "r2/blobs/report.bin")), Buffer.from([0, 128, 255, 10]));
  await assert.rejects(() => restoreBackup({ directory: backup.directory, destination: restored.directory }), /EEXIST/);
  await assert.rejects(() => createBackup({ stateRoot, backupRoot: path.join(stateRoot, "backups") }), /独立/);

  const damaged = path.join(root, "damaged");
  await cp(backup.directory, damaged, { recursive: true });
  await writeFile(path.join(damaged, "state/r2/blobs/report.bin"), "broken");
  await assert.rejects(() => verifyBackup(damaged), /文件校验失败/);
  await assert.rejects(() => restoreBackup({ directory: damaged, destination: path.join(root, "bad-restore") }), /文件校验失败/);
  await assert.rejects(() => stat(path.join(root, "bad-restore")), /ENOENT/);

  const traversal = path.join(root, "traversal");
  await cp(backup.directory, traversal, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(traversal, "manifest.json"), "utf8"));
  manifest.files[0].path = "d1/../../outside.sqlite";
  await writeFile(path.join(traversal, "manifest.json"), JSON.stringify(manifest));
  await assert.rejects(() => verifyBackup(traversal), /不安全/);
  const linked = path.join(root, "linked");
  await cp(backup.directory, linked, { recursive: true });
  await symlink(databasePath, path.join(linked, "state/d1/link.sqlite"));
  await assert.rejects(() => verifyBackup(linked), /符号链接/);
  // These test fixtures remain in the OS temporary directory for inspection.
});
