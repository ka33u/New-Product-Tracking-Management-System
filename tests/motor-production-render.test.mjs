import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import test from "node:test";

test("整机页面明确规格、确认依据、北京时间和历史待复核，操作隐藏且表单日期按状态必填", async () => {
  const require = createRequire(import.meta.url);
  const imports = { react: pathToFileURL(require.resolve("react")).href,
    "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href };
  async function compile(file, key) {
    let source = ts.transpileModule(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const [name, url] of Object.entries(imports)) source = source.replaceAll(JSON.stringify(name), JSON.stringify(url));
    const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    if (key) imports[key] = url;
    return import(url);
  }
  await compile("lib/npd-v2.ts", "../../../lib/npd-v2");
  await compile("app/components/npd/ui.tsx", "./ui");
  const { MotorProductionPanel, ConfirmMotorDialog } = await compile("app/components/npd/MotorProduction.tsx");
  const motor = { id: "m1", model: "QA-132S<&>", quantity: 2, designRevision: 7, plannedDate: "2026-09-09", actualDate: "2026-09-07",
    status: "completed", confirmedBy: "production", confirmedByName: "生产确认人甲", confirmedAt: "2026-09-07 00:01:02", productionNote: "QA说明<&>\n第二行" };
  const motors = [motor, { ...motor, id: "m2", model: "QA-160M", confirmedBy: null, confirmedAt: null, confirmedByName: null }];
  const props = { motors, canConfirm: true, onConfirm() {} };
  const html = renderToStaticMarkup(React.createElement(MotorProductionPanel, props));
  for (const value of ["整机生产节点", "QA-132S&lt;&amp;&gt;", "R7", "2", "2026-09-09", "2026-09-07", "2026-09-07 08:01", "生产确认人甲", "QA说明&lt;&amp;&gt;", "历史完工 · 待生产复核"]) assert.ok(html.includes(value), value);
  assert.match(html, /aria-label="确认整机节点：QA-132S&lt;&amp;&gt;"/);
  assert.match(html, /aria-label="确认整机节点：QA-160M"/);
  const readonly = renderToStaticMarkup(React.createElement(MotorProductionPanel, { ...props, canConfirm: false }));
  assert.doesNotMatch(readonly, /<button/); assert.match(readonly, /生产确认人甲/);
  const empty = renderToStaticMarkup(React.createElement(MotorProductionPanel, { ...props, motors: [] }));
  assert.match(empty, /尚未录入整机规格/); assert.doesNotMatch(empty, /<button/);
  for (const status of ["completed", "in_progress", "blocked", "planned"]) {
    const form = renderToStaticMarkup(React.createElement(ConfirmMotorDialog, { motor: { ...motor, status }, sheetVersion: 11, onClose() {}, onAction() {} }));
    assert.match(form, /role="dialog" aria-modal="true"/); assert.match(form, /设计 R7 · Sheet 5 V11/);
    assert.match(form, /不替代试验或质量合格结论/); assert.match(form, /原记录保留/);
    assert.match(form, /<textarea[^>]*name="note"[^>]*required=""/);
    const date = form.match(/<input[^>]*name="actualDate"[^>]*>/)?.[0]; assert.ok(date);
    assert.match(date, /type="date"/); assert.match(date, /max="\d{4}-\d{2}-\d{2}"/);
    if (status === "completed") { assert.match(date, /required=""/); assert.doesNotMatch(date, /disabled=/); }
    else { assert.match(date, /disabled=""/); assert.doesNotMatch(date, /required=/); }
  }
});
