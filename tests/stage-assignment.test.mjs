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
  for (const [name, url] of Object.entries({ "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href, ...imports })) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const assignmentUrl = await compile("../lib/stage-assignment.ts", {
  "./npd-v2": await compile("../lib/npd-v2.ts"), "./sheets-v2": await compile("../lib/sheets-v2.ts"),
});
const { stageAssignment } = await import(assignmentUrl);
const { StageAssignmentNotice } = await import(await compile("../app/components/npd/StageAssignmentNotice.tsx", { "../../../lib/stage-assignment": assignmentUrl }));
const user = (id, name, role = "design", active = true) => ({ id, name, role, active });
const member = (userId, projectId = "p", role = "design") => ({ userId, projectId, role, userName: `旧姓名${userId}` });
function fixture() {
  return { users: [user("a", "设计甲"), user("b", "设计乙"), user("c", "停用人员", "design", false), user("d", "别项目人员"), user("e", "未分配设计")],
    members: [member("a"), member("b"), member("c"), member("d", "other")],
    sheets: [{ projectId: "p", code: "input_output", ownerRole: "design" }],
    historicalReport: { submittedByName: "历史签署人", content: "原始内容" } };
}
test("当前岗位多成员完整列出，停用明确标注，不混入其他项目或未分配用户", () => {
  const data = fixture(); const before = structuredClone(data);
  const result = stageAssignment(data, "p", "input_output");
  assert.equal(result.label, "设计甲、设计乙、停用人员（账号已停用）");
  assert.equal(result.activeCount, 2); assert.equal(result.needsAssignment, false);
  assert.deepEqual(data, before, "显示逻辑不得改写历史或输入数据");
});
test("停用、重新启用、改名和岗位变更使用当前账号，不沿用旧成员资料", () => {
  const data = fixture(); data.users[0].active = false; data.users[1].role = "quality";
  let result = stageAssignment(data, "p", "input_output");
  assert.equal(result.activeCount, 0); assert.match(result.label, /设计待分配$/); assert.doesNotMatch(result.label, /设计乙/);
  data.users[0].active = true; data.users[0].name = "设计新姓名";
  result = stageAssignment(data, "p", "input_output");
  assert.equal(result.activeCount, 1); assert.match(result.label, /^设计新姓名/); assert.doesNotMatch(result.label, /待分配/);
});
test("空岗位和缺少账号提示待分配，同名不同人不合并，重复成员ID不重复", () => {
  const data = fixture(); data.members = [];
  assert.equal(stageAssignment(data, "p", "input_output").label, "设计待分配");
  data.members = [member("missing")];
  assert.equal(stageAssignment(data, "p", "input_output").label, "旧姓名missing（账户待核对）；设计待分配");
  data.members = [member("a"), member("a"), member("b")]; data.users[1].name = data.users[0].name;
  const result = stageAssignment(data, "p", "input_output");
  assert.equal(result.activeCount, 2); assert.equal(result.label, "设计甲、设计甲");
});
test("阶段切换与缺少阶段记录按对应责任岗位，不将项目负责人冒充节点人员", () => {
  const data = fixture(); data.users.push(user("t", "试验甲", "tester")); data.members.push(member("t", "p", "tester"));
  assert.equal(stageAssignment(data, "p", "verification").label, "试验甲");
  assert.equal(stageAssignment(data, "p", "initiation").label, "销售待分配");
});
test("阶段责任提示真实React渲染，缺员有操作指引，姓名安全转义", () => {
  const data = fixture(); data.users[0].name = "<script>甲</script>";
  const render = () => renderToStaticMarkup(React.createElement(StageAssignmentNotice, { snapshot: data, projectId: "p", sheetCode: "input_output" }));
  const html = render(); assert.match(html, /节点责任人/); assert.match(html, /&lt;script&gt;甲/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /停用人员（账号已停用）/); assert.doesNotMatch(html, /请项目负责人/);
  data.members = []; assert.match(render(), /请项目负责人或管理员在项目团队中分配启用的对应岗位人员/);
});
