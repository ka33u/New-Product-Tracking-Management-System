import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
async function source(path) { return readFile(new URL(path, root), "utf8"); }

test("production entry renders the V2 multi-sheet NPD workspace", async () => {
  const [page, layout, workspace, hosting] = await Promise.all([
    source("app/page.tsx"), source("app/layout.tsx"),
    source("app/components/NpdWorkspace.tsx"), source(".openai/hosting.json"),
  ]);
  assert.match(page, /<NpdWorkspace/);
  assert.match(page, /getNpdWorkspaceSnapshot/);
  assert.match(page, /resolveNpdCurrentUser/);
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
  assert.match(dialogs, /设计输出中的检验要求/);
});

test("roles, persistence, timestamps, exports and integrity gates stay wired", async () => {
  const [access, domain, schema, store, exportSource, actionRoute] = await Promise.all([
    source("lib/access-v2.ts"), source("lib/npd-v2.ts"), source("db/schema.ts"),
    source("db/store-v2.ts"), source("lib/export-v2.ts"), source("app/api/action/route.ts"),
  ]);
  for (const role of ["admin", "sales", "design", "production", "tester", "quality"]) {
    assert.match(domain, new RegExp(`"${role}"`));
  }
  assert.match(access, /project\.initiatorId === user\.id/);
  assert.match(access, /project\.ownerId === user\.id/);
  for (const table of ["npd_projects", "npd_sales_orders", "npd_project_motors", "npd_project_sheets", "npd_part_items", "npd_test_reports", "npd_inspection_records", "npd_activities"]) {
    assert.match(store, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(store, /validateSheetCompletion/);
  assert.match(store, /前置阶段/);
  assert.match(store, /质量记录未齐套/);
  assert.match(store, /CURRENT_TIMESTAMP/);
  assert.match(exportSource, /mso-application progid="Excel\.Sheet"/);
  assert.match(exportSource, /完整开发程序档案/);
  for (const kind of ["create_project", "create_order", "link_order", "add_motor", "create_test_report", "create_inspection", "create_user", "update_user", "save_dashboard_preference"]) {
    assert.match(actionRoute, new RegExp(kind));
  }
  assert.match(schema, /npdInspectionRecords/);
  assert.match(schema, /npdDashboardPreferences/);
});
