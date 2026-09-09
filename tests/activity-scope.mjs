import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

// All fixtures are synthetic, isolated from the installed local database.
export async function checkActivityScope(database = new D1Adapter()) {
  const store = await buildStoreModule(database);
  const admin = await store.resolveNpdCurrentUser(null, null);
  const viewer = await store.createNpdUser({ email: "activity-viewer@example.test", name: "日志范围验收人员",
    department: "合成验收", role: "quality", active: true }, admin);
  const unrelated = await store.createNpdUser({ email: "activity-other@example.test", name: "无关账户资料",
    department: "合成验收", role: "design", active: true }, admin);
  const projectId = "npd-p-001", privateProjectId = "npd-p-002";
  await database.prepare("INSERT INTO npd_project_members (id,project_id,user_id,responsibility) VALUES (?,?,?,?)")
    .bind("activity-scope-member", projectId, viewer.id, "合成日志范围验收").run();
  const add = (id, project, actor, type, entity, date = "2090-01-01 00:00:00") => database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,'合成范围验收',?,?,?,?)`)
    .bind(id, project, actor, type, entity, `合成日志 ${id}`, date);
  await database.batch([
    add("scope-visible", projectId, admin.id, "project", projectId),
    add("scope-private-authored", privateProjectId, viewer.id, "project", privateProjectId),
    add("scope-own-account", null, admin.id, "user", viewer.id),
    add("scope-other-account", null, admin.id, "user", unrelated.id),
    add("scope-own-preference", null, viewer.id, "dashboard", viewer.id),
    add("scope-other-preference", null, admin.id, "dashboard", admin.id),
  ]);
  const initial = await store.getNpdWorkspaceSnapshot(viewer);
  const errors = [];
  if (initial.activities.some(x => ["scope-other-account", "scope-other-preference"].includes(x.id))) errors.push("普通人员收到他人的全局管理日志");
  assert.ok(initial.activities.some(x => x.id === "scope-own-account"));
  assert.ok(initial.activities.some(x => x.id === "scope-own-preference"));
  assert.ok(initial.activities.some(x => x.id === "scope-visible"));
  assert.ok(!initial.activities.some(x => x.id === "scope-private-authored"), "自己操作过也不能绕过项目访问范围");
  await database.batch(Array.from({ length: 305 }, (_, index) =>
    add(`scope-noise-${index}`, privateProjectId, admin.id, "project", privateProjectId, "2099-01-01 00:00:00")));
  const recordsBefore = (await database.prepare("SELECT * FROM npd_activities ORDER BY id").all()).results;
  const limited = await store.getNpdWorkspaceSnapshot(viewer);
  if (!limited.activities.some(x => x.id === "scope-visible")) errors.push("先取全局300条再过滤，导致可见项目日志被无关日志挤掉");
  assert.deepEqual(errors, []);
  for (const role of ["sales", "design", "process", "procurement", "production", "tester", "quality"]) {
    await database.prepare("UPDATE npd_users SET role=? WHERE id=?").bind(role, viewer.id).run();
    const snapshot = await store.getNpdWorkspaceSnapshot({ ...viewer, role: "admin" });
    const ids = snapshot.activities.map(x => x.id);
    assert.ok(ids.includes("scope-visible") && ids.includes("scope-own-account") && ids.includes("scope-own-preference"), role);
    assert.ok(!ids.some(id => /scope-noise|scope-other|scope-private/.test(id)), `当前${role}不得沿用调用者缓存的管理员范围`);
  }
  const all = await store.getNpdWorkspaceSnapshot(admin);
  assert.equal(all.activities.length, 300);
  assert.equal(all.activities[0].id, "scope-noise-304", "同秒日志按写入顺序稳定倒序");
  assert.equal(all.activities[299].id, "scope-noise-5");
  const archive = await store.getNpdProjectArchiveData(privateProjectId, admin);
  assert.equal(archive.activities.filter(x => x.id.startsWith("scope-noise-")).length, 305, "项目归档不受工作区300条摘要上限影响");
  await database.prepare("DELETE FROM npd_project_members WHERE id='activity-scope-member'").run();
  assert.ok(!(await store.getNpdWorkspaceSnapshot(viewer)).activities.some(x => x.projectId), "移除成员后不得继续读取项目日志");
  await database.prepare("UPDATE npd_projects SET owner_id=? WHERE id=?").bind(viewer.id, projectId).run();
  assert.ok((await store.getNpdWorkspaceSnapshot(viewer)).activities.some(x => x.id === "scope-visible"), "负责人可见范围不依赖成员记录");
  await database.prepare("UPDATE npd_projects SET owner_id=?,initiator_id=? WHERE id=?").bind(admin.id, viewer.id, projectId).run();
  assert.ok((await store.getNpdWorkspaceSnapshot(viewer)).activities.some(x => x.id === "scope-visible"), "发起人仍可查看所属项目日志");
  await database.prepare("UPDATE npd_users SET active=0 WHERE id=?").bind(viewer.id).run();
  await assert.rejects(store.getNpdWorkspaceSnapshot({ ...viewer, role: "admin", active: true }), /停用/);
  assert.equal(JSON.stringify((await database.prepare("SELECT * FROM npd_activities ORDER BY id").all()).results), JSON.stringify(recordsBefore), "读取范围调整不能改写任何日志");
  console.log("日志范围通过：八角色、本人账户/偏好、发起/负责/成员、移除及停用、缓存角色拒绝、过滤先于300条上限、同秒稳定排序、完整归档和原始日志保留。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkActivityScope();
