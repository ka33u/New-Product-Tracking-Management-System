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
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, value] of Object.entries({ react: pathToFileURL(require.resolve("react")).href, "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href, ...imports })) code = code.replaceAll(JSON.stringify(name), JSON.stringify(value));
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const modelUrl = await compile("../lib/dashboard-model.ts");
const assignmentUrl = await compile("../lib/stage-assignment.ts", {
  "./npd-v2": await compile("../lib/npd-v2.ts"), "./sheets-v2": await compile("../lib/sheets-v2.ts"),
});
const { Dashboard } = await import(await compile("../app/components/npd/Dashboard.tsx", {
  "../../../lib/stage-assignment": assignmentUrl,
  "../../../lib/dashboard-model": modelUrl,
  "../../../lib/npd-v2": await compile("../lib/npd-v2.ts"), "./ui": await compile("../app/components/npd/ui.tsx"),
}));
const user = { id: "owner", role: "admin", name: "测试负责人", roleLabel: "管理员" };
const base = { users: [user], projects: [], sheets: [], members: [], dashboardPreference: { periodMode: "month", periodValue: "2026-06", customStart: "", customEnd: "", visibleMetrics: ["total", "onTime", "averageProgress"] } };
function render(snapshot) { return renderToStaticMarkup(React.createElement(Dashboard, { snapshot, currentUser: user, onOpenProject() {}, async onSavePreference() {} })); }
test("dashboard renders the selected period, exact zero bars, metric definitions and empty state", () => {
  const html = render(base);
  assert.match(html, /所选周期项目流量/);
  assert.doesNotMatch(html, /近 6 月|NaN|undefined/);
  assert.match(html, /2026-06-01 至 2026-06-30/);
  assert.match(html, /style="height:0px"/);
  assert.match(html, /<strong>—<\/strong>/);
  assert.match(html, /当前筛选没有项目/);
  assert.match(html, /不是历史时点快照/);
  assert.match(html, /导出全部概览/);
  assert.match(html, /查看流量明细/);
});
test("current stage lists all assigned people and content is escaped", () => {
  const html = render({ ...base, projects: [{ id: "p", code: "NP-QA", name: "<script>project</script>", seriesName: "测试", ownerId: "owner", ownerName: user.name,
    customerName: "合成客户", status: "active", plannedStart: "2026-01-01", plannedEnd: "2026-06-01", createdAt: "2026-06-01 00:00:00", updatedAt: "2026-06-01 00:00:00",
    progress: 50, motorCount: 1, currentSheetCode: "input_output", currentSheetTitle: "设计输入输出", riskLevel: "high" }],
    sheets: [{ projectId: "p", code: "input_output", ownerRole: "design", ownerRoleLabel: "设计" }],
    users: [...base.users, { id: "a", name: "设计甲", role: "design", active: true }, { id: "b", name: "设计乙", role: "design", active: true }, { id: "c", name: "停用设计", role: "design", active: false }],
    members: [{ userId: "a", projectId: "p", role: "design", userName: "设计甲" }, { userId: "b", projectId: "p", role: "design", userName: "设计乙" }, { userId: "c", projectId: "p", role: "design", userName: "停用设计" }],
  });
  assert.match(html, /设计甲、设计乙/);
  assert.match(html, /停用设计（账号已停用）/);
  assert.match(html, /&lt;script&gt;project/);
  assert.doesNotMatch(html, /<script>/);
});
