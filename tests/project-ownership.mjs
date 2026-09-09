import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkProjectOwnership(database = new D1Adapter()) {
  let beforeBatch;
  const wrapped = { prepare: (sql) => database.prepare(sql), async batch(statements) {
    const hook = beforeBatch; beforeBatch = null; if (hook) await hook();
    return database.batch(statements);
  } };
  const store = await buildStoreModule(wrapped);
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const projectId = "npd-p-001";
  const snapshot = () => store.getNpdWorkspaceSnapshot(admin);
  const original = await snapshot();
  const originalProject = original.projects.find((project) => project.id === projectId);
  const originalOwner = original.users.find((user) => user.id === originalProject.ownerId);
  const next = await store.createNpdUser({ email: "next-owner@example.test", name: "接任销售", role: "sales", department: "销售", active: true }, admin);
  const tester = original.users.find((user) => user.role === "tester");
  async function inputFor(newOwnerId) {
    const current = await snapshot();
    const project = current.projects.find((item) => item.id === projectId);
    return { projectId, newOwnerId, expectedOwnerId: project.ownerId, expectedOwnershipVersion: project.ownershipVersion,
      expectedLifecycleVersion: project.lifecycleVersion, reason: "人员调整，跟进待完成温升试验", previousOwnerResponsibility: "技术咨询与交接协作",
      newOwnerResponsibility: "项目总负责人与全流程维护", expectedMembers: Object.fromEntries([project.ownerId, newOwnerId].map((userId) => {
        const member = current.members.find((row) => row.projectId === projectId && row.userId === userId);
        return [userId, member ? { id: member.id, version: member.version } : null];
      })) };
  }
  const state = async () => {
    const result = {};
    for (const table of ["npd_projects", "npd_project_members", "npd_activities", "npd_project_sheets", "npd_sheet_revisions", "npd_test_reports", "npd_inspection_records", "npd_form_records"]) {
      result[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
    }
    return JSON.stringify(result);
  };
  const before = await state();
  const base = await inputFor(next.id);
  await assert.rejects(() => store.transferNpdProjectOwner(base, next), /只能访问|只有项目/);
  await assert.rejects(async () => store.transferNpdProjectOwner(await inputFor(tester.id), admin), /接任负责人/);
  for (const patch of [{ reason: "" }, { newOwnerResponsibility: "" }, { previousOwnerResponsibility: "" },
    { newOwnerId: originalOwner.id }, { expectedOwnershipVersion: undefined }, { expectedMembers: {} }]) {
    await assert.rejects(() => store.transferNpdProjectOwner({ ...base, ...patch }, admin));
  }
  assert.equal(await state(), before);
  await database.prepare("CREATE TRIGGER npd_owner_failure BEFORE UPDATE ON npd_projects BEGIN SELECT RAISE(ABORT,'Injected ownership failure'); END").run();
  try {
    await assert.rejects(() => store.transferNpdProjectOwner(base, admin), /Injected ownership failure/);
    assert.equal(await state(), before, "最后一步失败回滚新旧成员职责、版本与交接审计");
  } finally { await database.prepare("DROP TRIGGER npd_owner_failure").run(); }
  await store.setNpdProjectStatus(projectId, "paused", "等待交接", admin, originalProject.status, originalProject.lifecycleVersion);
  const pausedBase = await inputFor(next.id);
  await assert.rejects(() => store.transferNpdProjectOwner(base, admin), { name: "NpdConflictError" });
  await store.transferNpdProjectOwner(pausedBase, originalOwner);
  const handed = await snapshot();
  const handedProject = handed.projects.find((item) => item.id === projectId);
  assert.equal(handedProject.ownerId, next.id); assert.equal(handedProject.ownerName, next.name);
  assert.equal(handedProject.initiatorId, originalProject.initiatorId);
  assert.equal(handedProject.ownershipVersion, originalProject.ownershipVersion + 1);
  assert.equal(handedProject.lifecycleVersion, pausedBase.expectedLifecycleVersion); assert.equal(handedProject.status, "paused");
  const newMember = handed.members.find((item) => item.projectId === projectId && item.userId === next.id);
  const former = handed.members.find((item) => item.projectId === projectId && item.userId === originalOwner.id);
  assert.equal(newMember.responsibility, pausedBase.newOwnerResponsibility); assert.equal(newMember.version, 1);
  assert.equal(former.responsibility, pausedBase.previousOwnerResponsibility);
  for (const key of ["sheets", "sheetRevisions", "testReports", "inspections", "formRecords"]) {
    assert.deepEqual(handed[key], original[key], `交接不得重写${key}`);
  }
  assert.ok((await store.getNpdWorkspaceSnapshot(next)).projects.some((item) => item.id === projectId));
  assert.equal((await store.getNpdProjectArchiveData(projectId, next)).project.ownerName, next.name);
  await store.setNpdProjectStatus(projectId, "active", "交接后继续开发", next, "paused", handedProject.lifecycleVersion);
  await assert.rejects(() => store.createInspectionRecord({ projectId }, originalOwner), /只有质量/);
  await store.transferNpdProjectOwner(await inputFor(originalOwner.id), next);
  const restoredOwner = await snapshot();
  assert.equal(restoredOwner.projects.find((item) => item.id === projectId).ownershipVersion, originalProject.ownershipVersion + 2);
  const afterRoundTrip = await state();
  await assert.rejects(() => store.transferNpdProjectOwner(base, admin), { name: "NpdConflictError" });
  assert.equal(await state(), afterRoundTrip, "负责人A→B→A也不得使用原交接窗口");
  const concurrentBase = await inputFor(next.id);
  const outcomes = await Promise.allSettled([1, 2].map(() => store.transferNpdProjectOwner(concurrentBase, admin)));
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.name, "NpdConflictError");

  // The former owner remains an ordinary member. Capture their broad-owner
  // permission, then transfer just before their quality-phase save commits.
  const quality = (await snapshot()).sheets.find((sheet) => sheet.projectId === projectId && sheet.code === "quality_inspection");
  const transferBack = await inputFor(originalOwner.id);
  let afterIntervening;
  beforeBatch = async () => {
    await store.transferNpdProjectOwner(transferBack, admin);
    afterIntervening = await state();
  };
  await assert.rejects(() => store.updateProjectSheet(projectId, "quality_inspection", { status: "in_progress", progress: 20,
    plannedDate: quality.plannedDate, note: "过期负责人请求", changeReason: "不得留下此修改", expectedVersion: quality.version }, next), { name: "NpdConflictError" });
  assert.ok(afterIntervening); assert.equal(await state(), afterIntervening);
  const staleMemberInput = await inputFor(next.id);
  await store.assignProjectMember(projectId, next.id, "交接窗口打开后的新职责", admin, staleMemberInput.expectedMembers[next.id]);
  const withNewDuty = await state();
  await assert.rejects(() => store.transferNpdProjectOwner(staleMemberInput, admin), { name: "NpdConflictError" });
  assert.equal(await state(), withNewDuty);
  const targetRace = await inputFor(next.id);
  beforeBatch = async () => { await database.prepare("UPDATE npd_users SET active=0,version=version+1 WHERE id=?").bind(next.id).run(); };
  await assert.rejects(() => store.transferNpdProjectOwner(targetRace, admin), { name: "NpdConflictError" });
  assert.equal(await state(), withNewDuty, "接任人员提交前停用不能改变负责人");
  await database.prepare("UPDATE npd_users SET active=0,version=version+1 WHERE id=?").bind(originalOwner.id).run();
  await database.prepare("UPDATE npd_users SET active=1,version=version+1 WHERE id=?").bind(next.id).run();
  await store.transferNpdProjectOwner(await inputFor(next.id), admin);
  const afterDisabledOwner = (await snapshot()).projects.find((item) => item.id === projectId);
  assert.equal(afterDisabledOwner.ownerId, next.id, "原负责人停用时管理员仍能交接，不需要重新启用旧账户");
  await store.setNpdProjectStatus(projectId, "cancelled", "终止后交接权限测试", admin, afterDisabledOwner.status, afterDisabledOwner.lifecycleVersion);
  const closedInput = await inputFor(admin.id);
  await assert.rejects(() => store.transferNpdProjectOwner(closedInput, next), /仅管理员/);
  await store.transferNpdProjectOwner(closedInput, admin);
  assert.equal((await snapshot()).projects.find((item) => item.id === projectId).status, "cancelled", "终止项目交接不能隐式恢复");
  const audit = (await snapshot()).activities.find((item) => item.action === "项目负责人交接");
  assert.match(audit.detail, /交接版本 V\d+ → V\d+/); assert.match(audit.detail, /人员调整/);
  assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  console.log("负责人交接通过：暂停期间交接、权限及姓名联动、发起人与历史不变、职责版本、ABA/并发拒绝、末步回滚、提交期间交接/停用保护。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkProjectOwnership();
