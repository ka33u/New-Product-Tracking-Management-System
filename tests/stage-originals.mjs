import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";
import { validFormPayload } from "./form-release.mjs";

export function metadataBucket() {
  const objects = new Map();
  return {
    async put(key, body) { objects.set(key, { key, size: new TextEncoder().encode(body).length, etag: `test-${key}` }); },
    async head(key) { return objects.get(key) || null; },
    async delete(key) { objects.delete(key); },
  };
}

export async function checkStageOriginals(database = new D1Adapter(), bucket = metadataBucket()) {
  let headError = false, afterHead = null, headCount = 0;
  const monitoredBucket = { async head(key) {
    headCount++;
    if (headError) throw new Error("Injected R2 unavailable");
    const result = await bucket.head(key);
    if (afterHead) { const action = afterHead; afterHead = null; await action(); }
    return result;
  } };
  const store = await buildStoreModule(database, { FILES: monitoredBucket });
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const projectId = "npd-p-001";
  const initial = await store.getNpdProjectArchiveData(projectId, admin);
  const body = "隔离报告原件";
  const size = new TextEncoder().encode(body).length;
  const documents = [];
  async function addDocument(id, sheetCode) {
    const key = `npd/${projectId}/${sheetCode}/${id}`;
    await bucket.put(key, body);
    await database.prepare(`INSERT INTO npd_documents
      (id,project_id,sheet_code,file_name,object_key,content_type,size,uploaded_by)
      VALUES (?,?,?,? ,?,'text/plain',?,?)`).bind(id, projectId, sheetCode, `${id}.txt`, key, size, admin.id).run();
    const doc = { id, key, sheetCode }; documents.push(doc); return doc;
  }
  for (const [index, motor] of initial.motors.entries()) {
    const doc = await addDocument(`original-test-${index}`, "verification");
    await database.prepare(`INSERT INTO npd_test_reports
      (id,project_id,motor_id,report_no,report_type,title,requirement_ref,test_date,result,conclusion,
       document_id,requirement_revision,submitted_by,created_at)
      VALUES (?,?,?,?,'型式试验','原件核验',?,'2026-09-07','合格','齐套',?,?,?,'2099-01-01')`)
      .bind(doc.id, projectId, motor.id, doc.id, motor.testRequirement, doc.id, motor.designRevision, admin.id).run();
  }
  for (const [index, target] of [...initial.motors.map((row) => ({ row, type: "motor" })), ...initial.parts.map((row) => ({ row, type: "part" }))].entries()) {
    const { row, type } = target;
    const doc = await addDocument(`original-quality-${index}`, "quality_inspection");
    await database.prepare(`INSERT INTO npd_inspection_records
      (id,project_id,motor_id,part_item_id,item_type,inspection_requirement,inspection_date,result,conclusion,
       document_id,requirement_revision,inspector_id,created_at)
      VALUES (?,?,?,?,?,?,'2026-09-07','合格','齐套',?,?,?,'2099-01-01')`)
      .bind(doc.id, projectId, type === "motor" ? row.id : null, type === "part" ? row.id : null,
        type, row.inspectionRequirement, doc.id, row.designRevision, admin.id).run();
  }
  // Missing obsolete objects must not block the latest current-design evidence.
  const obsolete = await addDocument("original-obsolete", "verification");
  await bucket.delete(obsolete.key);
  const firstMotor = initial.motors[0];
  await database.prepare(`INSERT INTO npd_test_reports
    (id,project_id,motor_id,report_no,report_type,title,requirement_ref,test_date,result,document_id,requirement_revision,submitted_by,created_at)
    VALUES (?,?,?,?,'型式试验','旧报告',?,'2020-01-01','不合格',?,?,?,'2000-01-01')`)
    .bind(obsolete.id, projectId, firstMotor.id, obsolete.id, firstMotor.testRequirement, obsolete.id, firstMotor.designRevision, admin.id).run();
  await database.prepare("UPDATE npd_form_records SET status='submitted' WHERE project_id=?").bind(projectId).run();
  await database.prepare(`INSERT OR IGNORE INTO npd_form_records (id,project_id,form_code,sheet_code,status,payload,updated_by)
    VALUES ('original-verification-form',?,'HD/JL-SJ-06A1','verification','submitted','{}',?)`).bind(projectId, admin.id).run();
  await database.prepare("UPDATE npd_form_records SET payload=? WHERE project_id=? AND form_code='HD/JL-SJ-06A1'")
    .bind(JSON.stringify(validFormPayload("HD/JL-SJ-06A1")), projectId).run();
  const sheet = (code) => database.prepare("SELECT * FROM npd_project_sheets WHERE project_id=? AND code=?").bind(projectId, code).first();
  const release = async (code, api = store) => {
    const current = await sheet(code);
    return api.updateProjectSheet(projectId, code, { status: "completed", progress: 100, plannedDate: "2027-01-01",
      note: "原件核验", changeReason: "隔离放行测试", expectedVersion: current.version }, admin);
  };
  async function state() {
    const data = {};
    for (const table of ["npd_projects", "npd_project_sheets", "npd_sheet_revisions", "npd_activities", "npd_documents",
      "npd_project_motors", "npd_part_items", "npd_form_records", "npd_test_reports", "npd_inspection_records"]) {
      data[table] = (await database.prepare(`SELECT * FROM ${table} WHERE ${table === "npd_projects" ? "id" : "project_id"}=? ORDER BY id`).bind(projectId).all()).results;
    }
    return JSON.stringify(data);
  }
  const noStorage = await buildStoreModule(database, { FILES: undefined });
  await noStorage.ensureNpdDatabase();
  for (const code of ["verification", "quality_inspection"]) {
    const current = await sheet(code);
    await database.prepare("UPDATE npd_project_sheets SET status='completed' WHERE project_id=? AND sort_order<?").bind(projectId, current.sort_order).run();
    const doc = documents.find((row) => row.sheetCode === code);
    const failUnchanged = async (pattern, api = store) => {
      const before = await state();
      await assert.rejects(() => release(code, api), pattern);
      assert.equal(await state(), before, "失败放行不得更新业务/阶段/审计/版本");
    };
    await failUnchanged(/存储未就绪/, noStorage);
    await bucket.delete(doc.key);
    await failUnchanged(/原件缺失/);
    await bucket.put(doc.key, "错误大小");
    await failUnchanged(/与记录不一致/);
    await bucket.put(doc.key, body);
    headError = true;
    await failUnchanged(/暂时无法核验/);
    headError = false;
    await database.prepare("UPDATE npd_documents SET object_key='npd/other/private' WHERE id=?").bind(doc.id).run();
    const previousHeads = headCount;
    await failUnchanged(/记录异常/);
    assert.equal(headCount, previousHeads, "越界键不应读取存储");
    await database.prepare("UPDATE npd_documents SET object_key=?,size=0 WHERE id=?").bind(doc.key, doc.id).run();
    await failUnchanged(/记录异常/);
    await database.prepare("UPDATE npd_documents SET size=? WHERE id=?").bind(size, doc.id).run();
    // Index changed after original check, before the commit: reject via the SQL guard.
    const versionBefore = (await sheet(code)).version;
    afterHead = () => database.prepare("UPDATE npd_documents SET file_name='并发修改.txt' WHERE id=?").bind(doc.id).run();
    await assert.rejects(() => release(code), { name: "NpdConflictError" });
    assert.equal((await sheet(code)).version, versionBefore);
    await database.prepare("UPDATE npd_documents SET file_name=? WHERE id=?").bind(`${doc.id}.txt`, doc.id).run();
    // The existing revision context must also reject an intervening design edit.
    afterHead = () => database.prepare("UPDATE npd_project_sheets SET version=version+1 WHERE project_id=? AND code='input_output'").bind(projectId).run();
    await assert.rejects(() => release(code), { name: "NpdConflictError" });
    assert.equal((await sheet(code)).version, versionBefore);
    await release(code);
    assert.equal((await sheet(code)).status, "completed");
    const revision = await database.prepare("SELECT snapshot FROM npd_sheet_revisions WHERE project_id=? AND sheet_code=? ORDER BY version DESC LIMIT 1").bind(projectId, code).first();
    const receipts = JSON.parse(revision.snapshot).evidenceOriginals;
    assert.equal(receipts.length, documents.filter((row) => row.sheetCode === code && row.id !== obsolete.id).length);
    for (const receipt of receipts) {
      assert.equal(receipt.size, size); assert.ok(receipt.etag);
      assert.match(receipt.checkedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.equal(receipt.objectKey, undefined);
    }
  }
  console.log("原件放行核验通过：试验/整机及零部件检验、缺件/错长/存储故障零写入、过期报告忽略、索引与设计并发拦截、版本核验凭据。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkStageOriginals();
