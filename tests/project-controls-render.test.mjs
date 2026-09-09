import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
async function compile(file, names, bindings = {}) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Render real component bodies without exporting internal implementation details.
  const selected = names ? ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) : null;
  if (names) assert.equal(selected.length, names.length);
  const input = names ? selected.map(n => `${n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? "" : "export "}${n.getText(ast)}`).join("\n") : source;
  const code = ts.transpileModule(input, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", ...Object.keys(bindings), code)(require, module.exports, ...Object.values(bindings));
  return module.exports;
}
const labels = await compile("lib/npd-v2.ts");
const ui = await compile("app/components/npd/ui.tsx");
const calendar = await compile("lib/dashboard-model.ts");
const accountAndOrders = await compile("app/components/NpdWorkspace.tsx", ["Orders", "People", "Toast"], { ...React, ...labels, ...ui, ...calendar });
const evidence = await compile("lib/evidence-checks.ts");
const sheetDefinitions = await compile("lib/sheets-v2.ts");
const access = await compile("lib/access-v2.ts", ["canEditSheet", "isProjectSteward", "canManageProjectLifecycle"], sheetDefinitions);
const components = await compile("app/components/npd/ProjectWorkspace.tsx",
  ["Overview", "Delivery", "RequirementOutput", "PartsTable", "Reports", "Inspections", "Documents", "formatSize", "StageRecordedNote", "ProjectReadOnlyNotice", "ProjectLifecycleControl"], { ...labels, ...ui, ...evidence, ...access });
const { ConfirmPartDialog } = await compile("app/components/npd/Dialogs.tsx", ["ConfirmPartDialog"], { ...React, ...ui, ...labels });
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const motor = { id: "m", projectId: "p", model: "QA-132S<&>", status: "planned", designRevision: 1, quantity: 1,
  inspectionRequirement: "模拟检验", testRequirement: "模拟试验", plannedDate: "2026-09-08" };
const part = { id: "part", projectId: "p", partNo: "QA-P<&>", name: "模拟件", status: "planned", designRevision: 1, quantity: 1,
  inspectionRequirement: "模拟检验", plannedDate: "2026-09-08" };
const project = { id: "p", ownerId: "user", initiatorId: "starter", ownerName: "模拟设计", status: "active" };
const snapshot = { motors: [motor], parts: [part], users: [], members: [], activities: [], testReports: [], inspections: [], documents: [], sheets: [] };

test("write notices announce outcomes accurately and provide a named close button", () => {
  for (const type of ["success", "warning", "error"]) {
    const html = render(accountAndOrders.Toast, { type, title: type === "warning" ? "已保存，需重新登录" : undefined,
      message: "合成提示<&>", onDismiss: () => {} });
    assert.match(html, new RegExp(`role="${type === "success" ? "status" : "alert"}"`));
    assert.match(html, /aria-atomic="true"/);
    assert.match(html, /<button type="button" class="npd2-toast-close" aria-label="关闭提示"/);
    assert.match(html, /合成提示&lt;&amp;&gt;/);
    if (type === "warning") { assert.match(html, /已保存，需重新登录/); assert.doesNotMatch(html, /未能完成/); }
  }
});

test("order overdue dates use Beijing midnight and reject invalid legacy dates without changing them", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-30T16:05:00Z") });
  const dates = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-09-29", "", "2026-02-29", "invalid"];
  const orders = dates.map((deliveryDate, index) => ({ id: `o-${index}`, orderNo: `ORDER-${index}`, customerName: "合成客户",
    productSummary: "验收电机", projectCode: "", projectId: null, currency: "CNY", amount: 0, quantity: 1,
    orderDate: "2026-09-01", deliveryDate, status: index === 3 ? "completed" : "confirmed", createdByName: "验收销售" }));
  const before = structuredClone(orders);
  const html = render(accountAndOrders.Orders, { snapshot: { orders }, currentUser: { role: "sales" }, query: "" });
  const overdueDates = [...html.matchAll(/<td class="npd2-danger-cell">([^<]*)<\/td>/g)].map(match => match[1]);
  assert.deepEqual(overdueDates, ["2026-09-30"], "北京时间已到10月1日，昨日应逾期，当日/未来/完结/非法日期不得误判");
  assert.ok(html.includes("2026-02-29"), "无效旧值不得在展示时自动修成别的日期");
  assert.equal((html.match(/日期待核对/g) || []).length, 3, "空日期、非闰年2月29日和非法文字均提示核对，不伪装成有效日期");
  assert.deepEqual(orders, before);
});

test("account update dates use the stored instant in Beijing, not the UTC date prefix", () => {
  const users = [
    { id: "u1", name: "跨年账户", updatedAt: "2026-12-31 16:05:00" },
    { id: "u2", name: "闰日账户", updatedAt: "2024-02-28T16:05:00Z" },
    { id: "u3", name: "本地偏移账户", updatedAt: "2026-09-30T00:05:00+08:00" },
  ].map(user => ({ ...user, email: `${user.id}@example.test`, department: "合成验收", avatar: "验", role: "design", roleLabel: "设计", active: true }));
  const before = structuredClone(users);
  const html = render(accountAndOrders.People, { users, query: "" });
  assert.match(html, /更新 2027-01-01/);
  assert.match(html, /title="更新时间（北京时间）：2027-01-01 00:05"/);
  assert.match(html, /更新 2024-02-29/);
  assert.match(html, /更新 2026-09-30/);
  assert.doesNotMatch(html, /更新 2026-12-31|更新 2024-02-28/);
  assert.deepEqual(users, before);
});

test("form default dates agree with the business calendar at month, year and leap-day boundaries", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-12-31T16:05:00Z") });
  assert.equal(ui.today(), "2027-01-01");
  assert.equal(ui.today(), calendar.businessDate());
  assert.equal(ui.addDays(1), "2027-01-02");
  assert.equal(ui.addDays(-1), "2026-12-31");
  t.mock.timers.setTime(Date.parse("2024-02-28T16:05:00Z"));
  assert.equal(ui.today(), "2024-02-29");
  assert.equal(ui.addDays(1), "2024-03-01");
  t.mock.timers.setTime(Date.parse("2026-09-30T15:59:59Z"));
  assert.equal(ui.today(), "2026-09-30");
  assert.equal(ui.addDays(1), "2026-10-01");
});

test("working-surface typography uses scalable readable sizes and status pills are not icon boxes", async () => {
  const css = await readFile(new URL("../app/npd-v2.css", import.meta.url), "utf8");
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)];
  assert.ok(sizes.length > 50);
  for (const [, raw, unit] of sizes) {
    assert.equal(unit, "rem", `fixed font ${raw}${unit}`);
    assert.ok(Number(raw) >= .875, `unreadable font ${raw}${unit}`);
  }
  assert.doesNotMatch(css, /\.npd2-motor-card-head>span\s*\{/);
  assert.doesNotMatch(css, /\.npd2-project-cards header>span\s*\{/);
  assert.match(css, /\.npd2-motor-card-head>span:not\(\.npd2-badge\)/);
  assert.match(css, /\.npd2-project-cards header>span:not\(\.npd2-badge\)/);
});

test("compact layout includes responsibility, progress, dates and version metadata", async () => {
  const css = await readFile(new URL("../app/npd-v2.css", import.meta.url), "utf8");
  // Source regression guard; actual visibility, clipping and wrapping are browser-tested separately.
  const compact = css.slice(css.indexOf("/* Compact layouts"));
  assert.match(compact, /\.npd2-focus-row > \.npd2-focus-owner \{ display: flex/);
  assert.match(compact, /\.npd2-focus-row > \.npd2-stage \{ display: grid/);
  assert.match(compact, /\.npd2-focus-row > b \{ display: block/);
  assert.match(compact, /\.npd2-project-kpis \{ display: grid/);
  assert.match(compact, /\.npd2-task-list > button > \.npd2-task-stage \{ display: flex/);
  assert.match(compact, /\.npd2-task-list > button > div:nth-last-of-type\(1\) \{ display: flex/);
  assert.match(css, /\.npd2-sheet-meta \{ display: grid; min-width: 0/);
});

test("compact navigation has a named close action, expanded state and keyboard return path", async () => {
  const source = await readFile(new URL("../app/components/NpdWorkspace.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/npd-v2.css", import.meta.url), "utf8");
  assert.match(source, /aria-label=\{mobileNav \? "关闭导航" : "打开导航"\}/);
  assert.match(source, /aria-expanded=\{mobileNav\} aria-controls="npd-sidebar"/);
  assert.match(source, /id="npd-sidebar"/);
  assert.match(source, /event.key === "Escape" && mobileNav/);
  assert.match(source, /mobileNavTrigger.current\?\.focus\(\)/);
  assert.match(source, /mobileNavClose.current\?\.focus\(\)/);
  assert.match(source, /requestAnimationFrame\(\(\) => mobileNavClose.current\?\.focus\(\)\)/);
  assert.match(source, /cancelAnimationFrame\(frame\)/);
  assert.match(css, /\.npd2-sidebar \{ visibility: hidden; transition: transform \.2s; \}/);
  assert.match(css, /\.npd2-sidebar.open \{ visibility: visible; \}/);
});

test("overview respects paused and closed project locks while keeping authorized ownership handoff", () => {
  for (const status of ["active", "paused", "completed", "cancelled"]) {
    for (const role of ["admin", "design", "sales"]) {
      const html = render(components.Overview, { project: { ...project, status }, snapshot,
        currentUser: { id: "user", role }, motors: [motor], activities: [], steward: true, onDialog() {} });
      const writable = status !== "paused" && (role === "admin" || status === "active");
      if (writable) assert.match(html, /添加或维护项目成员/, `${role}/${status}`);
      else assert.doesNotMatch(html, /添加或维护项目成员|增加规格|变更规格与设计输出/, `${role}/${status}`);
      const handoff = role === "admin" || ["active", "paused"].includes(status);
      assert.equal(html.includes("负责人交接"), handoff, `${role}/${status} ownership`);
    }
  }
});

test("readonly notices and lifecycle controls give actionable guidance without exposing forbidden actions", () => {
  for (const status of ["active", "paused", "completed", "cancelled"]) {
    for (const [id, role] of [["user", "design"], ["starter", "sales"], ["member", "design"], ["quality", "quality"], ["admin", "admin"]]) {
      const props = { project: { ...project, status }, currentUser: { id, role }, onOpen() {} };
      const notice = render(components.ProjectReadOnlyNotice, props);
      const control = render(components.ProjectLifecycleControl, props);
      const managing = role === "admin" || (["user", "starter"].includes(id) && ["active", "paused"].includes(status));
      assert.equal(control.includes('<button'), managing, `${id}/${status}`);
      if (status === "paused") assert.match(notice, managing ? /右上方/ : /请联系项目负责人/);
      else if (["completed", "cancelled"].includes(status) && role !== "admin") {
        assert.match(notice, /当前为只读/); assert.match(notice, /联系管理员/); assert.doesNotMatch(notice, /右上方/);
      } else assert.equal(notice, "");
    }
  }
});

test("report and quality panels follow their own project stage without changing evidence or history", () => {
  const data = { ...snapshot, parts: [],
    testReports: [{ id: "t", projectId: "p", motorId: "m", reportNo: "QA-T", title: "模拟报告", result: "合格", documentId: "dt", requirementRevision: 1,
      reportType: "型式试验", requirementRef: motor.testRequirement, conclusion: "模拟通过", createdAt: "2026-09-08 15:31:00", testDate: "2026-09-08" }],
    inspections: [{ id: "i", projectId: "p", itemType: "motor", motorId: "m", itemName: motor.model, requirementRevision: 1, result: "合格", documentId: "di", inspectionDate: "2026-09-08",
      inspectionRequirement: motor.inspectionRequirement, conclusion: "模拟通过", createdAt: "2026-09-08 15:31:00" }],
    documents: [{ id: "dt", projectId: "p", sheetCode: "verification" }, { id: "di", projectId: "p", sheetCode: "quality_inspection" }],
  };
  for (const [Component, code] of [[components.Reports, "verification"], [components.Inspections, "quality_inspection"]]) {
    for (const [status, label] of [["completed", "证据齐套 · 阶段已完成"], ["pending_review", "证据齐套 · 待阶段复核"], ["in_progress", "证据齐套 · 待阶段复核"], ["blocked", "证据齐套 · 阶段受阻"]]) {
      const current = { ...data, sheets: [{ projectId: "foreign", code, status: "completed" }, { projectId: "p", code, status }] };
      const before = JSON.stringify(current);
      const html = render(Component, { project, snapshot: current, editable: false });
      assert.ok(html.includes(label), `${code}/${status}: ${label}`);
      if (status === "completed") assert.doesNotMatch(html, /待阶段复核|齐套后仍需/);
      else assert.doesNotMatch(html, /阶段已完成/);
      assert.equal(JSON.stringify(current), before, "presentation leaves source data intact");
      const missing = render(Component, { project, snapshot: { ...current, documents: [] }, editable: false });
      assert.match(missing, status === "completed" ? /完成状态需复核/ : /证据待补齐/);
      assert.doesNotMatch(missing, /证据齐套 · 阶段已完成/);
    }
    assert.match(render(Component, { project, snapshot: { ...data, sheets: [{ projectId: "foreign", code, status: "completed" }] }, editable: false }), /阶段状态待确认/);
  }
  const empty = render(components.Inspections, { project, snapshot: { ...data, motors: [], parts: [], sheets: [{ projectId: "p", code: "quality_inspection", status: "completed" }] }, editable: false });
  assert.match(empty, /0\/0/);
  assert.match(empty, /完成状态需复核/);
  assert.doesNotMatch(empty, /证据齐套 · 阶段已完成/);
});

test("stage notes are labelled as recorded text and preserve old wording verbatim", () => {
  const note = "当前设计版次的报告记录及附件索引已齐套，阶段放行时还将核验原件。\n用户补充<&>";
  const html = render(components.StageRecordedNote, { note, blocked: false });
  assert.match(html, /阶段备注（记录时内容）/);
  assert.ok(html.includes(note.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")));
  assert.equal(render(components.StageRecordedNote, { note: "", blocked: false }), "");
  assert.match(render(components.StageRecordedNote, { note, blocked: true }), /npd2-stage-note blocked/);
});

test("ZIP uses the same native download navigation as the other exports, without popup targeting", async () => {
  const source = await readFile(new URL("../app/components/npd/ProjectWorkspace.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("ProjectWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const links = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === "a") {
      const href = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === "href");
      if (href?.initializer?.getText(ast).includes("format=bundle")) links.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(links.length, 1);
  const attributes = links[0].attributes.properties.map(p => p.name?.getText(ast));
  assert.ok(!attributes.includes("target"));
  assert.ok(!attributes.includes("onClick"), "native response streaming, not JS whole-file buffering");
  assert.match(links[0].getText(ast), /未加密，请妥善保管/);
});

test("team and specification controls have explicit context and preserve readonly visibility", () => {
  const props = { project, snapshot, currentUser: { id: "user", role: "design" }, motors: [motor], activities: [], steward: true, onDialog() {} };
  const team = render(components.Overview, props);
  assert.match(team, /aria-label="添加或维护项目成员"/);
  assert.doesNotMatch(render(components.Overview, { ...props, steward: false, currentUser: { role: "quality" } }), /aria-label="添加或维护项目成员"/);
  const output = render(components.RequirementOutput, { motors: [motor], editable: true, onDialog() {} });
  assert.match(output, /aria-label="变更设计输出：QA-132S&lt;&amp;&gt;"/);
  assert.doesNotMatch(render(components.RequirementOutput, { motors: [motor], editable: false }), /<button/);
});

test("part operations name their target; confirmation summary uses Chinese for every known state", () => {
  for (const role of ["production", "design", "admin"]) {
    const html = render(components.PartsTable, { parts: [part], currentUser: { role }, editable: true, onDialog() {} });
    assert.match(html, new RegExp(`aria-label="${role === "production" ? "生产确认" : "变更零部件"}：QA-P&lt;&amp;&gt; 模拟件"`));
  }
  for (const [status, label] of Object.entries({ planned: "计划中", in_progress: "进行中", completed: "已完成", blocked: "受阻" })) {
    const html = render(ConfirmPartDialog, { part: { ...part, status }, sheetVersion: 1, onClose() {}, onAction() {} });
    assert.ok(html.includes(`当前状态<b>${label}</b>`));
  }
  assert.equal(labels.partStatusLabel("historical-custom"), "historical-custom", "unknown historical states are not relabelled as planned");
});

test("report download links name the specimen and report; quality links name target, revision and date", () => {
  const data = { ...snapshot, testReports: [{ id: "t", projectId: "p", motorId: "m", reportNo: "QA-T<&>", title: "模拟报告", result: "合格", documentId: "dt", requirementRevision: 1,
    reportType: "型式试验", requirementRef: motor.testRequirement, conclusion: "模拟通过", createdAt: "2026-09-08 15:31:00", testDate: "2026-09-08" }],
    inspections: [{ id: "i", projectId: "p", itemType: "motor", motorId: "m", itemName: motor.model, requirementRevision: 1, result: "合格", documentId: "di", inspectionDate: "2026-09-08",
      inspectionRequirement: motor.inspectionRequirement, conclusion: "模拟通过", createdAt: "2026-09-08 15:31:00" }] };
  const tests = render(components.Reports, { project, snapshot: data, editable: false });
  assert.match(tests, /aria-label="下载试验附件：QA-132S&lt;&amp;&gt; · QA-T&lt;&amp;&gt;"/);
  assert.match(tests, /href="\/api\/files\/dt"/);
  const quality = render(components.Inspections, { project, snapshot: data, editable: false });
  assert.match(quality, /aria-label="下载检验附件：QA-132S&lt;&amp;&gt; · R1 · 2026-09-08"/);
  assert.match(quality, /href="\/api\/files\/di"/);
  assert.doesNotMatch(quality, /<button/);
});

test("attachment index displays Chinese kinds without changing unknown metadata, URLs or filenames", () => {
  for (const [kind, label] of Object.entries({ test_report: "试验报告", inspection_record: "检验记录", stage_attachment: "阶段附件", attachment: "附件", "legacy-kind": "legacy-kind" })) {
    const html = render(components.Documents, { documents: [{ id: "d", kind, fileName: "合成<&>.txt", size: 234, version: "A1", uploadedByName: "模拟人员", createdAt: "2026-09-08 15:31:00" }] });
    assert.ok(html.includes(`<small>${label} ·`));
    assert.match(html, /href="\/api\/files\/d"/);
    assert.match(html, /合成&lt;&amp;&gt;\.txt/);
    assert.match(html, /2026-09-08 23:31/);
  }
});
