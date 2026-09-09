import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkDesignProgress(database = new D1Adapter()) {
  const store = await buildStoreModule(database);
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const projectId = "npd-p-001";
  const initial = await store.getNpdProjectArchiveData(projectId, admin);
  const { motors, parts } = initial;
  assert.ok(motors.length >= 2 && parts.length >= 1);
  const sheet = (code) => database.prepare("SELECT * FROM npd_project_sheets WHERE project_id=? AND code=?").bind(projectId, code).first();
  const progress = (complete, total) => Math.round(complete / total * 90);
  async function state() {
    const rows = {};
    for (const table of ["npd_projects", "npd_project_sheets", "npd_sheet_revisions", "npd_activities", "npd_project_motors", "npd_part_items", "npd_documents", "npd_test_reports", "npd_inspection_records"]) {
      rows[table] = (await database.prepare(`SELECT * FROM ${table} WHERE ${table === "npd_projects" ? "id" : "project_id"}=? ORDER BY id`).bind(projectId).all()).results;
    }
    return JSON.stringify(rows);
  }
  async function aggregate() {
    const actual = await database.prepare("SELECT progress FROM npd_projects WHERE id=?").bind(projectId).first();
    const expected = await database.prepare("SELECT ROUND(AVG(progress)) AS progress FROM npd_project_sheets WHERE project_id=?").bind(projectId).first();
    assert.equal(actual.progress, expected.progress, "项目汇总必须与提交后的阶段进度一致");
  }
  async function latest(code) {
    const row = await database.prepare("SELECT * FROM npd_sheet_revisions WHERE project_id=? AND sheet_code=? ORDER BY version DESC LIMIT 1").bind(projectId, code).first();
    const current = await sheet(code);
    assert.equal(row.version, current.version);
    assert.equal(row.progress, current.progress);
    const snapshot = JSON.parse(row.snapshot);
    assert.equal(snapshot.progress, current.progress);
    assert.equal(snapshot.status, current.status);
    return snapshot;
  }
  async function document(id, code) {
    await database.prepare(`INSERT INTO npd_documents (id,project_id,sheet_code,file_name,object_key,content_type,size,uploaded_by)
      VALUES (?,?,?,?,?,'text/plain',10,?)`).bind(id, projectId, code, `${id}.txt`, `isolated/${id}`, admin.id).run();
  }
  // Isolated metadata fixtures: no live attachments or business records are read.
  for (const [i, motor] of motors.entries()) {
    const id = `design-progress-test-${i}`;
    await document(id, "verification");
    await database.prepare(`INSERT INTO npd_test_reports
      (id,project_id,motor_id,report_no,report_type,title,requirement_ref,test_date,result,conclusion,document_id,requirement_revision,submitted_by,created_at)
      VALUES (?,?,?,?,'型式试验','改版进度测试',?,'2026-09-07','合格','齐套',?,?,?,'2099-01-01')`)
      .bind(id, projectId, motor.id, id, motor.testRequirement, id, motor.designRevision, admin.id).run();
  }
  for (const [i, { row, type }] of [...motors.map((row) => ({ row, type: "motor" })), ...parts.map((row) => ({ row, type: "part" }))].entries()) {
    const id = `design-progress-inspection-${i}`;
    await document(id, "quality_inspection");
    await database.prepare(`INSERT INTO npd_inspection_records
      (id,project_id,motor_id,part_item_id,item_type,inspection_requirement,inspection_date,result,conclusion,document_id,requirement_revision,inspector_id,created_at)
      VALUES (?,?,?,?,?,?,'2026-09-07','合格','齐套',?,?,?,'2099-01-01')`)
      .bind(id, projectId, type === "motor" ? row.id : null, type === "part" ? row.id : null, type, row.inspectionRequirement, id, row.designRevision, admin.id).run();
  }
  await database.prepare("UPDATE npd_part_items SET status='completed',actual_date='2026-09-07',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE project_id=?").bind(admin.id, projectId).run();
  await database.prepare("UPDATE npd_project_motors SET status='completed',actual_date='2026-09-07',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE project_id=?").bind(admin.id, projectId).run();
  await database.prepare("UPDATE npd_project_sheets SET progress=90,status='in_progress' WHERE project_id=? AND code IN ('parts_plan','verification','quality_inspection')").bind(projectId).run();
  const originalReports = (await state());
  const baseQuality = await sheet("quality_inspection");
  const baseVerification = await sheet("verification");
  const part = parts[0];
  await store.updatePartItem(part.id, { ...part, expectedRevision: part.designRevision, inspectionRequirement: "改版后新增圆度检验", changeReason: "中途增加要求" }, admin);
  assert.equal((await sheet("parts_plan")).progress, progress(motors.length + parts.length - 1, motors.length + parts.length));
  assert.equal((await sheet("quality_inspection")).progress, progress(motors.length + parts.length - 1, motors.length + parts.length));
  assert.equal((await sheet("quality_inspection")).version, baseQuality.version + 1);
  assert.equal((await sheet("verification")).version, baseVerification.version, "零部件变更不应虚构电机试验变更");
  const snapshot = await latest("quality_inspection");
  const changed = snapshot.data.parts.find((row) => row.id === part.id);
  assert.equal(changed.design_revision, part.designRevision + 1);
  assert.equal(changed.status, "planned");
  assert.equal(changed.confirmed_by, null);
  assert.equal(changed.actual_date, null);
  assert.equal(snapshot.previousProgress, 90);
  await aggregate();
  await assert.rejects(() => store.updateProjectSheet(projectId, "quality_inspection", {
    expectedVersion: baseQuality.version, status: "in_progress", progress: 90, plannedDate: baseQuality.planned_date,
    note: "过期页面", changeReason: "不得覆盖关联变更",
  }, admin), { name: "NpdConflictError" });
  const original = JSON.parse(originalReports), current = JSON.parse(await state());
  for (const table of ["npd_test_reports", "npd_inspection_records", "npd_documents"]) assert.deepEqual(current[table], original[table], "历史报告和附件必须原样保留");

  await store.addPartItem({ ...part, projectId, partNo: "ADDED-PROGRESS-PART", motorId: null }, admin);
  assert.equal((await sheet("parts_plan")).progress, progress(motors.length + parts.length - 1, motors.length + parts.length + 1));
  assert.equal((await sheet("quality_inspection")).progress, progress(motors.length + parts.length - 1, motors.length + parts.length + 1));
  await aggregate();

  // Preserve blockers while recomputing evidence, and invalidate completed release.
  await database.prepare("UPDATE npd_project_sheets SET status='blocked',note='等待客户处置' WHERE project_id=? AND code='quality_inspection'").bind(projectId).run();
  await database.prepare("UPDATE npd_project_sheets SET status='completed',progress=100,actual_date='2026-09-07' WHERE project_id=? AND code='verification'").bind(projectId).run();
  await store.addProjectMotor(projectId, { ...motors[0], model: "ADDED-PROGRESS-MOTOR" }, admin);
  assert.equal((await sheet("verification")).progress, progress(motors.length, motors.length + 1));
  assert.equal((await sheet("verification")).status, "pending_review");
  assert.equal((await sheet("verification")).actual_date, null);
  assert.equal((await sheet("quality_inspection")).progress, progress(motors.length + parts.length - 1, motors.length + parts.length + 2));
  assert.equal((await sheet("quality_inspection")).status, "blocked");
  assert.match((await sheet("quality_inspection")).note, /等待客户处置/);
  await latest("verification"); await latest("quality_inspection"); await aggregate();

  await store.updateMotorRequirements(motors[0].id, "新检验要求", "新试验要求", admin, motors[0].designRevision);
  assert.equal((await sheet("verification")).progress, progress(motors.length - 1, motors.length + 1));
  assert.equal((await sheet("quality_inspection")).progress, progress(motors.length + parts.length - 2, motors.length + parts.length + 2));
  await store.updateProjectMotor(motors[1].id, { ...motors[1], expectedRevision: motors[1].designRevision, terminalMode: "右侧", changeReason: "规格变更" }, admin);
  assert.equal((await sheet("verification")).progress, progress(motors.length - 2, motors.length + 1));
  assert.equal((await sheet("quality_inspection")).progress, progress(motors.length + parts.length - 3, motors.length + parts.length + 2));
  await latest("verification"); await latest("quality_inspection"); await aggregate();

  const stable = await state();
  await database.prepare(`CREATE TRIGGER design_progress_failure BEFORE UPDATE ON npd_projects
    BEGIN SELECT RAISE(ABORT,'Injected design progress failure'); END`).run();
  try {
    await assert.rejects(() => store.addProjectMotor(projectId, { ...motors[0], model: "MUST-ROLLBACK-PROGRESS" }, admin), /Injected design progress failure/);
    assert.equal(await state(), stable, "末步故障必须同时回滚目标、关联进度、版本快照和审计");
  } finally { await database.prepare("DROP TRIGGER design_progress_failure").run(); }
  console.log("设计变更进度联动通过：改版/扩项分子分母、生产确认重置、旧证据保留、受阻保留、放行撤回、版本快照、过期页面拦截、汇总与故障回滚。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkDesignProgress();
