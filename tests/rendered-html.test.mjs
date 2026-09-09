import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = new URL("../", import.meta.url);
async function source(path) { return readFile(new URL(path, root), "utf8"); }

test("UI audit times normalize SQLite UTC and ISO offsets to Beijing time", async () => {
  const require = createRequire(import.meta.url);
  const runtime = pathToFileURL(require.resolve("react/jsx-runtime")).href;
  const code = ts.transpileModule(await source("app/components/npd/ui.tsx"), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
  } }).outputText.replaceAll(JSON.stringify("react/jsx-runtime"), JSON.stringify(runtime))
    .replaceAll(JSON.stringify("react"), JSON.stringify(pathToFileURL(require.resolve("react")).href));
  const { formatDateTime, formatDate, today, addDays } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  assert.equal(formatDateTime("2026-09-07 02:14:00"), "2026-09-07 10:14");
  assert.equal(formatDateTime("2026-09-07T02:14:00.123Z"), "2026-09-07 10:14");
  assert.equal(formatDateTime("2026-09-07T10:14:00+08:00"), "2026-09-07 10:14");
  assert.equal(formatDateTime("2026-12-31T16:05:00Z"), "2027-01-01 00:05");
  assert.equal(formatDateTime("2026-09-07T10:14:00-04:00"), "2026-09-07 22:14");
  assert.equal(formatDateTime("2026-09-07"), "2026-09-07");
  for (const value of [null, undefined, "", "invalid", "2026-99-07 02:14:00"]) assert.equal(formatDateTime(value), "—");
  assert.equal(formatDate("2026-12-31 16:05:00"), "2027-01-01");
  assert.equal(formatDate("2026-09-07"), "2026-09-07");
  const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
  assert.equal(today(), expected.format(new Date()));
  assert.equal(addDays(120), expected.format(new Date(Date.now() + 120 * 86_400_000)));
});

test("local logout controls render a POST form in project and recovery surfaces", async () => {
  const require = createRequire(import.meta.url);
  const jsxRuntime = pathToFileURL(require.resolve("react/jsx-runtime")).href;
  async function compile(file, imports = {}) {
    let code = ts.transpileModule(await source(file), { compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    for (const [name, url] of Object.entries({ react: pathToFileURL(require.resolve("react")).href, "react/jsx-runtime": jsxRuntime, ...imports })) {
      code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
    }
    return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  }
  const ui = await compile("app/components/npd/ui.tsx");
  const { SignOutControl } = await import(await compile("app/components/npd/SignOutControl.tsx", { "./ui": ui }));
  for (const label of ["退出", "切换登录账号"]) {
    const html = renderToStaticMarkup(React.createElement(SignOutControl, { path: "/api/local-auth/logout", label }));
    assert.match(html, /<form action="\/api\/local-auth\/logout" method="post">/);
    assert.match(html, /<button type="submit"/);
    assert.ok(html.includes(label));
    assert.doesNotMatch(html, /<a /);
  }
  const hosted = renderToStaticMarkup(React.createElement(SignOutControl, { path: "/signout-with-chatgpt?return_to=%2F" }));
  assert.match(hosted, /<a href="\/signout-with-chatgpt/);
  assert.match(await source("app/page.tsx"), /SignOutControl path=\{isLocalNpdMode\(\) \? "\/api\/local-auth\/logout"/);
  assert.match(await source("app/components/npd/ProjectWorkspace.tsx"), /SignOutControl path=\{signOutPath\}/);
});

test("production entry renders the V2 multi-sheet NPD workspace", async () => {
  const [page, layout, workspace, hosting] = await Promise.all([
    source("app/page.tsx"), source("app/layout.tsx"),
    source("app/components/NpdWorkspace.tsx"), source(".openai/hosting.json"),
  ]);
  assert.match(page, /<NpdWorkspace/);
  assert.match(page, /getNpdWorkspaceSnapshot/);
  assert.match(page, /getNpdRequestUser/);
  assert.match(page, /创建首位管理员/);
  assert.match(layout, /亨达新品开发/);
  assert.match(layout, /lang="zh-CN"/);
  for (const label of ["项目看板", "新品项目", "销售订单", "我的任务", "人员权限", "创建新项目", "新建账户", "当前进度节点"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.deepEqual(JSON.parse(hosting), {
    project_id: "appgprj_6a6221a29cd08191b2032670daf76cf2",
    d1: "DB", r2: "FILES",
  });
});

test("ten controlled forms map into ten phase sheets", async () => {
  const [forms, sheets, projectUi, dialogs] = await Promise.all([
    source("lib/forms.ts"), source("lib/sheets-v2.ts"),
    source("app/components/npd/ProjectWorkspace.tsx"),
    source("app/components/npd/Dialogs.tsx"),
  ]);
  for (let index = 1; index <= 10; index++) {
    const code = `HD/JL-SJ-${String(index).padStart(2, "0")}A1`;
    assert.match(forms, new RegExp(code.replaceAll("/", "\\/")));
  }
  for (const code of ["initiation", "input_output", "development_plan", "design_review", "parts_plan", "verification", "quality_inspection", "customer_trial", "identification", "change_archive"]) {
    assert.match(sheets, new RegExp(code));
  }
  assert.match(projectUi, /项目概览/);
  assert.match(projectUi, /导出本 Sheet/);
  assert.match(projectUi, /零部件明细与计划节点/);
  assert.match(projectUi, /规格级试验报告/);
  assert.match(projectUi, /质量检验记录/);
  assert.match(projectUi, /版本与修改记录/);
  assert.match(dialogs, /设计输出中的检验要求/);
});

test("roles, persistence, timestamps, exports and integrity gates stay wired", async () => {
  const [access, domain, schema, store, exportSource, actionRoute] = await Promise.all([
    source("lib/access-v2.ts"), source("lib/npd-v2.ts"), source("db/schema.ts"),
    source("db/store-v2.ts"), source("lib/export-v2.ts"), source("app/api/action/route.ts"),
  ]);
  for (const role of ["admin", "sales", "design", "process", "procurement", "production", "tester", "quality"]) {
    assert.match(domain, new RegExp(`"${role}"`));
  }
  assert.match(access, /project\.initiatorId === user\.id/);
  assert.match(access, /project\.ownerId === user\.id/);
  for (const table of ["npd_projects", "npd_sales_orders", "npd_project_motors", "npd_project_sheets", "npd_sheet_revisions", "npd_local_sessions", "npd_part_items", "npd_test_reports", "npd_inspection_records", "npd_activities"]) {
    assert.match(store, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(store, /validateSheetCompletion/);
  assert.match(store, /前置阶段/);
  assert.match(store, /getStageEvidence/);
  assert.match(store, /inspectionEvidenceIssues\(String\(row.inspection_requirement/);
  assert.match(await source("lib/evidence-checks.ts"), /缺少检验附件/);
  assert.match(store, /CURRENT_TIMESTAMP/);
  assert.match(exportSource, /from "\.\/xlsx-runtime"/);
  assert.match(exportSource, /完整开发程序档案/);
  for (const kind of ["create_project", "create_order", "link_order", "add_motor", "update_motor", "update_part", "create_test_report", "create_inspection", "create_user", "update_user", "save_dashboard_preference"]) {
    assert.match(actionRoute, new RegExp(kind));
  }
  assert.match(schema, /npdInspectionRecords/);
  assert.match(schema, /npdDashboardPreferences/);
  assert.match(schema, /npdSheetRevisions/);
});
