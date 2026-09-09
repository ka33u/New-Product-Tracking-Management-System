import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkMotorProduction(database = new D1Adapter()) {
  const store = await buildStoreModule(database);
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const seed = await store.getNpdWorkspaceSnapshot(admin);
  const projectId = "npd-p-001";
  const production = seed.users.find((row) => row.role === "production");
  const motor = seed.motors.find((row) => row.projectId === projectId);
  const getMotor = () => database.prepare("SELECT * FROM npd_project_motors WHERE id=?").bind(motor.id).first();
  const getSheet = () => database.prepare("SELECT * FROM npd_project_sheets WHERE project_id=? AND code='parts_plan'").bind(projectId).first();
  const input = async (extra = {}) => ({ motorId: motor.id, status: "completed", actualDate: "2026-09-07", note: "QA 整机确认",
    expectedRevision: (await getMotor()).design_revision, expectedSheetVersion: (await getSheet()).version, ...extra });
  async function state() {
    const rows = {};
    for (const table of ["npd_projects", "npd_project_sheets", "npd_sheet_revisions", "npd_activities", "npd_project_motors", "npd_part_items"]) {
      rows[table] = (await database.prepare(`SELECT * FROM ${table} WHERE ${table === "npd_projects" ? "id" : "project_id"}=? ORDER BY id`).bind(projectId).all()).results;
    }
    return JSON.stringify(rows);
  }
  async function reject(payload, actor, pattern) {
    const before = await state(); await assert.rejects(() => store.confirmMotorProduction(payload, actor), pattern);
    assert.equal(await state(), before, "失败确认不能留下部分写入");
  }
  for (const role of ["sales", "design", "tester", "quality", "process", "procurement"]) {
    await reject(await input(), seed.users.find((row) => row.role === role), /只有生产|无权/);
  }
  for (const extra of [{ status: "fake" }, { actualDate: "2026-02-30" }, { actualDate: "2099-01-01" }, { actualDate: "" }, { note: " " }]) {
    await reject(await input(extra), production, /状态无效|日期|说明/);
  }
  await reject(await input({ expectedRevision: 0 }), production, { name: "NpdConflictError" });
  const stale = await input();
  await store.confirmMotorProduction(stale, production);
  const first = await getMotor();
  assert.equal(first.status, "completed"); assert.equal(first.confirmed_by, production.id); assert.ok(first.confirmed_at);
  assert.equal(first.production_note, stale.note); assert.equal(first.actual_date, "2026-09-07");
  await reject(stale, production, { name: "NpdConflictError" });
  const mapped = (await store.getNpdProjectArchiveData(projectId, admin)).motors.find((row) => row.id === motor.id);
  assert.equal(mapped.confirmedByName, production.name); assert.equal(mapped.productionNote, stale.note);
  // All current nodes must carry a production receipt, not merely a legacy status.
  await database.prepare("UPDATE npd_part_items SET status='completed',actual_date='2026-09-07',confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP WHERE project_id=?").bind(production.id, projectId).run();
  await database.prepare("UPDATE npd_project_sheets SET status='completed',progress=100 WHERE project_id=? AND sort_order<5").bind(projectId).run();
  const release = async () => store.updateProjectSheet(projectId, "parts_plan", { expectedVersion: (await getSheet()).version, status: "completed", progress: 100,
    plannedDate: "2027-01-05", note: "QA阶段复核", changeReason: "QA全部确认" }, admin);
  await assert.rejects(release, /整机或零部件/);
  const motors = seed.motors.filter((row) => row.projectId === projectId && row.id !== motor.id);
  for (const item of motors) await store.confirmMotorProduction(await input({ motorId: item.id, expectedRevision: item.designRevision }), production);
  assert.equal((await getSheet()).progress, 90);
  await release(); assert.equal((await getSheet()).progress, 100);
  await database.prepare("UPDATE npd_project_sheets SET status='completed',progress=100,actual_date='2026-09-07' WHERE project_id=? AND sort_order>5").bind(projectId).run();
  await store.confirmMotorProduction(await input({ status: "blocked", note: "QA返工，撤回原完工" }), production);
  assert.equal((await getMotor()).actual_date, null);
  const downstream = (await database.prepare("SELECT status,actual_date FROM npd_project_sheets WHERE project_id=? AND sort_order>5").bind(projectId).all()).results;
  assert.ok(downstream.every((row) => row.status === "pending_review" && row.actual_date === null));
  const revisions = (await database.prepare("SELECT snapshot FROM npd_sheet_revisions WHERE project_id=? AND sheet_code='parts_plan' ORDER BY version").bind(projectId).all()).results.map((row) => JSON.parse(row.snapshot));
  assert.ok(revisions.some((row) => row.before?.id === motor.id && row.before.actual_date === "2026-09-07"));
  await store.confirmMotorProduction(await input(), production);
  const beforeR = await getMotor();
  await store.updateMotorRequirements(motor.id, "QA改版检验", "QA改版试验", admin, beforeR.design_revision);
  const changed = await getMotor();
  assert.equal(changed.status, "planned"); assert.equal(changed.actual_date, null); assert.equal(changed.confirmed_by, null);
  assert.equal(changed.confirmed_at, null); assert.equal(changed.production_note, ""); assert.equal(changed.design_revision, beforeR.design_revision + 1);
  await reject(await input({ expectedRevision: beforeR.design_revision }), production, { name: "NpdConflictError" });
  // Last-step failure rolls back motor, all affected stages, receipts and audit.
  const stable = await state();
  await database.prepare("CREATE TRIGGER motor_confirmation_failure BEFORE UPDATE ON npd_projects BEGIN SELECT RAISE(ABORT,'Injected motor failure'); END").run();
  try { await reject(await input(), production, /Injected motor failure/); } finally { await database.prepare("DROP TRIGGER motor_confirmation_failure").run(); }
  assert.equal(await state(), stable);
  const concurrent = await input();
  const results = await Promise.allSettled([store.confirmMotorProduction(concurrent, production), store.confirmMotorProduction(concurrent, admin)]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(results.find((row) => row.status === "rejected").reason.name, "NpdConflictError");
  await database.prepare("UPDATE npd_projects SET status='paused' WHERE id=?").bind(projectId).run();
  await reject(await input(), admin, /暂停/);
  await database.prepare("UPDATE npd_projects SET status='active' WHERE id=?").bind(projectId).run();
  await database.prepare("DELETE FROM npd_project_members WHERE project_id=? AND user_id=?").bind(projectId, production.id).run();
  await reject(await input(), production, /只能访问/);
  assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  console.log("整机生产确认通过：权限、日期、版本冲突、完整回滚、并发、返工撤回、改版重置、阶段门禁与实名归档。");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkMotorProduction();
