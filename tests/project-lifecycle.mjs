import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";
import { validFormPayload } from "./form-release.mjs";

export async function checkProjectLifecycle(database = new D1Adapter()) {
  let beforeBatch = null;
  const guardedDatabase = {
    prepare: (sql) => database.prepare(sql),
    async batch(statements) {
      const hook = beforeBatch; beforeBatch = null;
      if (hook) await hook();
      return database.batch(statements);
    },
  };
  const store = await buildStoreModule(guardedDatabase);
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const projectId = "npd-p-001";
  const project = () => database.prepare("SELECT * FROM npd_projects WHERE id=?").bind(projectId).first();
  const sheets = async () => (await database.prepare("SELECT * FROM npd_project_sheets WHERE project_id=? ORDER BY sort_order").bind(projectId).all()).results;
  const form = () => database.prepare("SELECT * FROM npd_form_records WHERE project_id=? AND form_code='HD/JL-SJ-01A1'").bind(projectId).first();
  const businessState = async () => {
    const result = {};
    for (const table of ["npd_projects", "npd_form_records", "npd_project_sheets", "npd_sheet_revisions", "npd_activities"]) {
      result[table] = (await database.prepare(`SELECT * FROM ${table} WHERE ${table === "npd_projects" ? "id" : "project_id"}=? ORDER BY id`).bind(projectId).all()).results;
    }
    return JSON.stringify(result);
  };
  async function transition(status, reason) {
    const current = await project();
    await store.setNpdProjectStatus(projectId, status, reason, admin, current.status, current.lifecycle_version);
  }
  const original = await project();
  const formBefore = await form();
  const sheetsBefore = await sheets();
  let interveningState;
  beforeBatch = async () => {
    await transition("paused", "验证期间暂停");
    await transition("active", "验证期间恢复");
    interveningState = await businessState();
  };
  await assert.rejects(() => store.saveNpdFormRecord(projectId, "HD/JL-SJ-01A1", { stale: "不得保存" }, false,
    admin, "状态往返期间的旧请求", formBefore.version), { name: "NpdConflictError" });
  assert.ok(interveningState, "必须实际在阶段事务提交前注入暂停/恢复");
  assert.equal(await businessState(), interveningState, "阶段请求失败不改变并行状态操作，不写入领域数据、阶段版次或审计");
  assert.deepEqual(await form(), formBefore);
  assert.deepEqual(await sheets(), sheetsBefore, "状态版本不替代或凭空递增阶段版本");
  assert.equal((await project()).lifecycle_version, original.lifecycle_version + 2);

  const lifecycleBefore = await project();
  beforeBatch = async () => {
    await transition("paused", "终止决定提交前暂停");
    await transition("active", "终止决定提交前恢复");
    interveningState = await businessState();
  };
  await assert.rejects(() => store.setNpdProjectStatus(projectId, "cancelled", "过期终止决定", admin,
    lifecycleBefore.status, lifecycleBefore.lifecycle_version), { name: "NpdConflictError" });
  assert.equal(await businessState(), interveningState, "状态事务自身也必须在提交时拒绝ABA");
  const invalidState = await businessState();
  for (const invalid of [undefined, null, 0, -1, 1.5, "5", Number.NaN]) {
    await assert.rejects(() => store.setNpdProjectStatus(projectId, "paused", "错误版次", admin, "active", invalid), { name: "NpdConflictError" });
  }
  assert.equal(await businessState(), invalidState);

  const sales = await store.createNpdUser({ email: "lifecycle-sales@example.test", name: "临时销售成员", department: "销售",
    role: "sales", active: true }, admin);
  await store.assignProjectMember(projectId, sales.id, "立项资料协作", admin, null);
  const beforeRevocation = await businessState();
  let revoked = false;
  beforeBatch = async () => {
    // Simulate removal by an independent permission operation, only in this isolated database.
    await database.prepare("DELETE FROM npd_project_members WHERE project_id=? AND user_id=?").bind(projectId, sales.id).run();
    revoked = true;
  };
  await assert.rejects(() => store.saveNpdFormRecord(projectId, "HD/JL-SJ-01A1", { revoked: true }, false,
    sales, "权限撤销后不得保存", formBefore.version), { name: "NpdConflictError" });
  assert.ok(revoked); assert.equal(await businessState(), beforeRevocation);

  // Prepare an isolated final-stage fixture; this checks aggregate versioning,
  // not the validity of every preceding project's development report.
  await database.prepare("UPDATE npd_project_sheets SET status='completed',progress=100 WHERE project_id=? AND code<>'change_archive'").bind(projectId).run();
  await database.prepare(`INSERT INTO npd_form_records (id,project_id,sheet_code,form_code,status,payload,updated_by)
    VALUES ('lifecycle-final-form',?,'change_archive','HD/JL-SJ-09A1','submitted',?,?)
    ON CONFLICT(project_id,form_code) DO UPDATE SET status='submitted',payload=excluded.payload`).bind(projectId, JSON.stringify(validFormPayload("HD/JL-SJ-09A1")), admin.id).run();
  const finalSheet = (await sheets()).find((sheet) => sheet.code === "change_archive");
  const preCompletion = await project();
  await store.updateProjectSheet(projectId, "change_archive", { status: "completed", progress: 100,
    plannedDate: finalSheet.planned_date, note: "归档完成", changeReason: "聚合版次测试", expectedVersion: finalSheet.version }, admin);
  assert.equal((await project()).status, "completed");
  assert.equal((await project()).lifecycle_version, preCompletion.lifecycle_version + 1);
  const completedSheet = (await sheets()).find((sheet) => sheet.code === "change_archive");
  await store.updateProjectSheet(projectId, "change_archive", { status: "in_progress", progress: 90,
    plannedDate: finalSheet.planned_date, note: "补充归档", changeReason: "管理员重新打开末阶段", expectedVersion: completedSheet.version }, admin);
  assert.equal((await project()).status, "active");
  assert.equal((await project()).actual_end, null);
  assert.equal((await project()).lifecycle_version, preCompletion.lifecycle_version + 2);
  const currentSheet = (await sheets()).find((sheet) => sheet.code === "change_archive");
  await store.updateProjectSheet(projectId, "change_archive", { status: "in_progress", progress: 95,
    plannedDate: finalSheet.planned_date, note: "继续补充", changeReason: "状态不变", expectedVersion: currentSheet.version }, admin);
  assert.equal((await project()).lifecycle_version, preCompletion.lifecycle_version + 2, "日常进度不应无故递增项目状态版本");
  const archive = await store.getNpdProjectArchiveData(projectId, admin);
  assert.equal(archive.project.lifecycleVersion, (await project()).lifecycle_version);
  assert.ok(archive.activities.some((activity) => /状态版本 V\d+ → V\d+/.test(activity.detail)));
  assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  console.log("项目生命周期通过：状态/阶段提交期间暂停恢复ABA拒绝、成员撤权阻止保存、缺版本零写入、自动完成/重开递增且日常进度不递增。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkProjectLifecycle();
