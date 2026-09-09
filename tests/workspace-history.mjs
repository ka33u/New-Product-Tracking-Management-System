import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkWorkspaceHistory(database = new D1Adapter()) {
  let capture = false, metadataBytes = 0;
  const wrapped = { prepare: (sql) => database.prepare(sql), async batch(statements) {
    const result = await database.batch(statements);
    if (capture) {
      assert.equal(statements.length, 15, "仍然使用单次一致读取，不另发历史查询");
      const revisions = result[7].results;
      metadataBytes = Buffer.byteLength(JSON.stringify(revisions));
      assert.ok(revisions.every((row) => !Object.hasOwn(row, "snapshot")), "工作区不应从数据库搬运完整历史正文后再丢弃");
    }
    return result;
  } };
  const store = await buildStoreModule(wrapped);
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const projectId = "npd-p-001";
  const initial = await store.getNpdWorkspaceSnapshot(admin);
  const payload = JSON.stringify({ marker: "历史原文必须完整保留", content: "X".repeat(32768) });
  // Synthetic history size fixture, not a claimed sequence of real approvals.
  for (let group = 0; group < 20; group++) {
    await database.batch(Array.from({ length: 50 }, (_, offset) => {
      const index = group * 50 + offset + 2;
      return database.prepare(`INSERT INTO npd_sheet_revisions
        (id,project_id,sheet_code,version,action,summary,reason,status,progress,planned_date,actor_id,snapshot)
        VALUES (?,?,'initiation',?,'规模测试','历史摘要','测试夹具','in_progress',20,'2027-01-01',?,?)`)
        .bind(`history-${index}`, projectId, index, admin.id, payload);
    }));
  }
  capture = true;
  const snapshot = await store.getNpdWorkspaceSnapshot(admin);
  capture = false;
  assert.equal(snapshot.sheetRevisions.length, initial.sheetRevisions.length + 1000, "不通过截断历史数量来加速");
  assert.ok(snapshot.sheetRevisions.some((row) => row.id === "history-2"));
  assert.ok(snapshot.sheetRevisions.some((row) => row.id === "history-1001"));
  assert.ok(metadataBytes < 1024 * 1024);
  const detail = await store.getNpdRevisionDetail("history-1001", admin);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.snapshot)), JSON.parse(payload));
  const archive = await store.getNpdProjectArchiveData(projectId, admin);
  assert.equal(archive.revisions.find((row) => row.id === "history-2").snapshotJson, payload);
  assert.equal(archive.revisions.find((row) => row.id === "history-1001").snapshotJson, payload);
  const raw = await database.prepare("SELECT SUM(length(CAST(snapshot AS BLOB))) AS bytes FROM npd_sheet_revisions").first();
  const outsider = await store.createNpdUser({ email: "history-outsider@example.test", name: "历史隔离测试", role: "quality", department: "质量", active: true }, admin);
  assert.equal((await store.getNpdWorkspaceSnapshot(outsider)).sheetRevisions.length, 0);
  await assert.rejects(() => store.getNpdRevisionDetail("history-2", outsider), /只能访问/);
  console.log(JSON.stringify({ check: "workspace-history", revisions: snapshot.sheetRevisions.length, storedSnapshotBytes: raw.bytes,
    returnedDatabaseRevisionMetadataBytes: metadataBytes, fullDetailAndArchivePreserved: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkWorkspaceHistory();
