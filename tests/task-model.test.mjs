import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function compile(file, imports = {}) {
  let code = ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [name, url] of Object.entries({ react: pathToFileURL(require.resolve("react")).href, "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href, ...imports })) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const npd = await compile("../lib/npd-v2.ts"), sheets = await compile("../lib/sheets-v2.ts"), dates = await compile("../lib/dashboard-model.ts");
const access = await compile("../lib/access-v2.ts", { "./sheets-v2": sheets });
const assignments = await compile("../lib/stage-assignment.ts", { "./npd-v2": npd, "./sheets-v2": sheets });
const { buildTaskModel } = await import(await compile("../lib/task-model.ts", { "./access-v2": access, "./dashboard-model": dates, "./stage-assignment": assignments }));
const { Tasks } = await import(await compile("../app/components/npd/Tasks.tsx", { "../../../lib/npd-v2": npd, "../../../lib/sheets-v2": sheets, "./ui": await compile("../app/components/npd/ui.tsx") }));
const { sheetDefinitions } = await import(sheets);
const { businessDate } = await import(dates);
function fixture(role = "admin") {
  const user = { id: "me", name: "本人", role, active: true };
  const project = { id: "p", code: "P01", name: "测试项目", ownerId: "owner", initiatorId: "starter", status: "active" };
  return { user, data: { users: [user], projects: [project], members: [{ projectId: "p", userId: "me", role, userName: "本人" }],
    sheets: sheetDefinitions.map((definition) => ({ id: definition.code, projectId: "p", code: definition.code, sortOrder: definition.index,
      ownerRole: definition.ownerRole, ownerRoleLabel: "责任角色", status: "not_started", plannedDate: "2026-09-07" })) } };
}
const build = (data, user) => buildTaskModel(data, user, "2026-09-07");
test("暂停退出待办但保留查看，恢复重新计入，关闭项目连管理员也不算待办", () => {
  const { data, user } = fixture(); const before = structuredClone(data);
  assert.equal(build(data, user).pending.length, 10); assert.deepEqual(data, before);
  data.projects[0].status = "paused";
  let model = build(data, user); assert.equal(model.pending.length, 0); assert.equal(model.paused.length, 10); assert.equal(model.atRisk, 0);
  data.projects[0].status = "active"; assert.equal(build(data, user).pending.length, 10);
  for (const status of ["cancelled", "completed"]) { data.projects[0].status = status; model = build(data, user); assert.equal(model.pending.length, 0); assert.equal(model.paused.length, 0); }
  data.projects[0].status = "draft"; assert.equal(build(data, user).pending.length, 10);
  assert.deepEqual(data.sheets, before.sheets, "分类不修改阶段记录或日期");
});
test("八角色按现有维护权限归集，工艺和采购协作阶段不漏计", () => {
  const expected = { admin: 10, sales: 2, design: 6, process: 5, procurement: 2, production: 1, tester: 1, quality: 1 };
  for (const [role, count] of Object.entries(expected)) { const { data, user } = fixture(role); assert.equal(build(data, user).pending.length, count, role); }
  for (const key of ["ownerId", "initiatorId"]) { const { data, user } = fixture("sales"); data.projects[0][key] = user.id; assert.equal(build(data, user).pending.length, 10); }
});
test("当前账号停用、角色改变、成员撤销或孤立阶段不泄漏任务或多计侧栏", () => {
  const { data, user } = fixture("design"); const oldUser = structuredClone(user);
  data.users[0].role = "quality"; assert.equal(build(data, oldUser).pending.length, 1);
  data.users[0].active = false; assert.equal(build(data, oldUser).pending.length, 0);
  data.users[0].active = true; data.members = []; assert.equal(build(data, oldUser).pending.length, 0);
  data.projects = []; data.users[0].role = "admin"; assert.equal(build(data, oldUser).pending.length, 0);
});
test("北京日期边界、当天不逾期、无效日期排末且不算逾期，受阻单独计入风险", () => {
  const { data, user } = fixture(); data.sheets = data.sheets.slice(0, 4);
  Object.assign(data.sheets[0], { plannedDate: "2026-09-06" });
  Object.assign(data.sheets[1], { plannedDate: "" });
  Object.assign(data.sheets[2], { plannedDate: "2026-02-30", status: "blocked" });
  assert.equal(businessDate(new Date("2026-09-06T15:59:59Z")), "2026-09-06");
  const asOf = businessDate(new Date("2026-09-06T16:00:00Z")); assert.equal(asOf, "2026-09-07");
  const model = buildTaskModel(data, user, asOf);
  assert.deepEqual(model.pending.map((task) => task.dueLabel), ["2026-09-06", "2026-09-07", "未设置", "日期待核对"]);
  assert.equal(model.pending.filter((task) => task.overdue).length, 1); assert.equal(model.atRisk, 2); assert.equal(model.invalidDates, 2);
  assert.throws(() => buildTaskModel(data, user, "2026-02-30"), /日期无效/);
});
test("完成统计只按当前已完成且本人最后维护的可见阶段，不声称历史次数", () => {
  const { data, user } = fixture("design");
  Object.assign(data.sheets[0], { status: "completed", updatedBy: "me" });
  Object.assign(data.sheets[1], { status: "completed", updatedBy: "other" });
  Object.assign(data.sheets[2], { status: "pending_review", updatedBy: "me" });
  assert.equal(build(data, user).completedByMe, 1);
  data.members = []; assert.equal(build(data, user).completedByMe, 0);
});
test("任务页真实React渲染同一模型：空状态不误称全部完成，暂停有独立入口，姓名安全转义", () => {
  const { data, user } = fixture(); data.projects[0].name = "<script>项目</script>"; data.projects[0].status = "paused";
  const html = renderToStaticMarkup(React.createElement(Tasks, { model: build(data, user), onOpen() {} }));
  assert.match(html, /当前没有可处理的阶段任务/); assert.match(html, /暂停项目中的阶段 · 10 项（不计入待办）/);
  assert.match(html, /&lt;script&gt;项目/); assert.doesNotMatch(html, /<script>|均已完成/);
  assert.match(html, /暂停不会自动顺延计划日期/);
});
