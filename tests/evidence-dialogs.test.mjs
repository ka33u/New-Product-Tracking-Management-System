import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Run actual dialog callbacks with isolated hook state. This is not browser QA.
const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/components/npd/Dialogs.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Dialogs.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["TestReportDialog", "InspectionDialog", "UploadedEvidenceNotice"];
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(selected.length, names.length);
const code = ts.transpileModule(selected.map(node => `${node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? "" : "export "}${node.getText(ast)}`).join("\n"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const hooks = { values: [], cursor: 0 };
const useState = initial => {
  const i = hooks.cursor++;
  if (!(i in hooks.values)) hooks.values[i] = typeof initial === "function" ? initial() : initial;
  return [hooks.values[i], value => { hooks.values[i] = typeof value === "function" ? value(hooks.values[i]) : value; }];
};
const useRef = initial => { const i = hooks.cursor++; return hooks.values[i] ??= { current: initial }; };
const bindings = { useState, useRef, today: () => "2026-09-09", getFormObject: form => form.raw };
for (const name of ["Modal", "Field", "Icon", "SubmitBar"]) bindings[name] = () => null;
const module = { exports: {} };
new Function("require", "exports", ...Object.keys(bindings), code)(require, module.exports, ...Object.values(bindings));

function elements(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function text(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node !== "object") return String(node);
  return text(typeof node.type === "function" && node.type === module.exports.UploadedEvidenceNotice ? node.type(node.props) : node.props?.children);
}
function fixture(kind, { upload = async () => "document-1", action = async () => null, file = new File(["synthetic"], "原件.txt") } = {}) {
  hooks.values = []; hooks.cursor = 0;
  const calls = { upload: [], action: [], closed: 0 };
  const props = {
    project: { id: "project", code: "QA-NPD" },
    motors: [1, 2].map(n => ({ id: `motor-${n}`, model: `QA-${n}`, designRevision: n, testRequirement: `试验要求${n}`, inspectionRequirement: `整机要求${n}` })),
    parts: [1, 2].map(n => ({ id: `part-${n}`, partNo: `PART-${n}`, name: `零件${n}`, designRevision: n + 2, inspectionRequirement: `零件要求${n}` })),
    onClose: () => { calls.closed++; },
    onUpload: async (...args) => { calls.upload.push(args); return upload(...args); },
    onAction: async (...args) => { calls.action.push(args); return action(...args); },
  };
  const form = { raw: { reportNo: "QA-REPORT", reportType: "型式试验", title: "合成验收", requirementRef: "试验要求1", testDate: "2026-09-09", inspectionDate: "2026-09-09", result: "合格", conclusion: "合成说明" },
    elements: { namedItem: name => { assert.equal(name, "file"); return { files: file ? [file] : [] }; } } };
  const Component = module.exports[kind === "test" ? "TestReportDialog" : "InspectionDialog"];
  const render = () => { hooks.cursor = 0; return Component(props); };
  const handler = () => elements(render()).find(node => node.type === "form").props.onSubmit;
  const event = () => ({ preventDefault() {}, currentTarget: form });
  const submit = () => handler()(event());
  const select = value => elements(render()).find(node => node.type === "select" && !node.props.name).props.onChange({ target: { value } });
  const part = () => elements(render()).find(node => node.type === "button" && node.props.children === "零部件检验").props.onClick();
  render();
  return { props, form, calls, render, submit, handler, event, select, part, setFile: next => { file = next; } };
}

for (const kind of ["test", "inspection"]) {
  test(`${kind}: a failed record submission retains its acknowledged attachment and retries only the record`, async () => {
    let attempts = 0;
    const f = fixture(kind, { action: async () => { if (++attempts === 1) throw new Error("请补齐结论"); } });
    await f.submit();
    assert.equal(f.calls.upload.length, 1); assert.equal(f.calls.action.length, 1); assert.equal(f.calls.closed, 0);
    assert.equal(f.calls.action[0][1].documentId, "document-1");
    assert.match(text(f.render()), /请补齐结论/);
    assert.match(text(f.render()), /附件已保留/);
    assert.match(text(f.render()), /原件.txt/);
    assert.match(text(f.render()), /QA-1.*R1/);
    assert.doesNotMatch(text(f.render()), /记录已提交|记录尚未提交/);
    assert.equal(f.render().props.busy, false);
    f.form.raw.conclusion = "合成补充依据";
    await f.submit();
    assert.equal(f.calls.upload.length, 1); assert.equal(f.calls.action.length, 2); assert.equal(f.calls.closed, 1);
    assert.equal(f.calls.action[1][1].documentId, "document-1");
    assert.equal(f.calls.action[1][1].conclusion, "合成补充依据");
  });

  test(`${kind}: repeated callbacks before rendering start only one upload and one record write`, async () => {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const f = fixture(kind, { upload: async () => { await gate; return "document-only"; } });
    const submit = f.handler();
    const first = submit(f.event()); const second = submit(f.event());
    const uploads = f.calls.upload.length;
    finish(); await Promise.all([first, second]);
    assert.equal(uploads, 1); assert.equal(f.calls.action.length, 1); assert.equal(f.calls.closed, 1);
  });

  test(`${kind}: the submission lock spans the record request, including records without an attachment`, async () => {
    let finish; let started;
    const entered = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { finish = resolve; });
    const f = fixture(kind, { file: null, action: async () => { started(); await gate; } });
    const submit = f.handler(); const first = submit(f.event());
    await entered;
    const second = submit(f.event());
    const writes = f.calls.action.length;
    finish(); await Promise.all([first, second]);
    assert.equal(f.calls.upload.length, 0); assert.equal(writes, 1); assert.equal(f.calls.closed, 1);
  });

  test(`${kind}: upload failure never submits an empty record; a later deliberate retry can succeed`, async () => {
    let attempts = 0;
    const f = fixture(kind, { upload: async () => { if (++attempts === 1) throw new Error("未能确认服务器是否已保存，先核对后重试"); return "later-document"; } });
    await f.submit();
    assert.equal(f.calls.action.length, 0); assert.equal(f.calls.closed, 0); assert.equal(f.render().props.busy, false);
    assert.match(text(f.render()), /未能确认服务器是否已保存/);
    assert.doesNotMatch(text(f.render()), /附件已保留/);
    await f.submit();
    assert.equal(f.calls.upload.length, 2); assert.equal(f.calls.action.length, 1);
    assert.equal(f.calls.action[0][1].documentId, "later-document"); assert.equal(f.calls.closed, 1);
  });

  test(`${kind}: unknown record outcome keeps the upload receipt without falsely claiming success or failure`, async () => {
    const f = fixture(kind, { action: async () => { throw new Error("未能确认服务器是否已保存，不要重复提交"); } });
    await f.submit();
    assert.equal(f.calls.upload.length, 1); assert.equal(f.calls.action.length, 1); assert.equal(f.calls.closed, 0);
    assert.match(text(f.render()), /未能确认服务器是否已保存/); assert.match(text(f.render()), /附件已保留/);
    assert.doesNotMatch(text(f.render()), /记录已提交|记录尚未提交/);
  });

  test(`${kind}: changing file or target never attaches the cached receipt to a different selection`, async () => {
    let serial = 0;
    const f = fixture(kind, { upload: async () => `document-${++serial}`, action: async () => { throw new Error("保留窗口"); } });
    await f.submit();
    f.select("motor-2"); await f.submit();
    assert.equal(f.calls.action[1][1].documentId, "document-2"); assert.equal(f.calls.action[1][1].motorId, "motor-2");
    f.setFile(new File(["changed"], "新原件.txt")); await f.submit();
    assert.equal(f.calls.action[2][1].documentId, "document-3");
    f.setFile(null); await f.submit();
    assert.equal(f.calls.upload.length, 3); assert.equal(f.calls.action[3][1].documentId, null);
    assert.match(text(f.render()), /新原件.txt/);
  });

  test(`${kind}: an open dialog keeps the design revision used for its input, even if new props arrive`, async () => {
    const f = fixture(kind, { action: async () => { throw new Error("旧版本应由服务端拒绝"); } });
    f.props.motors = f.props.motors.map(motor => ({ ...motor, designRevision: 99, testRequirement: "新要求", inspectionRequirement: "新要求" }));
    await f.submit();
    assert.equal(f.calls.action[0][1].expectedRevision, 1);
    assert.equal(f.calls.closed, 0); assert.match(text(f.render()), /R1/);
  });
}

test("quality part receipts retain the exact component and its design revision, with no motor mislink", async () => {
  const f = fixture("inspection", { action: async () => { throw new Error("填写待补"); } });
  f.part(); f.select("part-2"); await f.submit();
  assert.equal(f.calls.upload[0][1].motorId, null);
  assert.equal(f.calls.action[0][1].itemType, "part"); assert.equal(f.calls.action[0][1].partItemId, "part-2");
  assert.equal(f.calls.action[0][1].expectedRevision, 4);
  assert.match(text(f.render()), /PART-2.*零件2.*R4/);
  await f.submit(); assert.equal(f.calls.upload.length, 1); assert.equal(f.calls.action.length, 2);
});

test("receipt text is escaped, names the uploaded target, and never fabricates record completion", async () => {
  const render = receipt => renderToStaticMarkup(React.createElement(module.exports.UploadedEvidenceNotice, { receipt }));
  assert.equal(render(null), "");
  const html = render({ fileName: "报告<&>.txt", targetLabel: "端盖<&> · R3" });
  assert.match(html, /role="status"/); assert.match(html, /附件已保留/);
  assert.match(html, /报告&lt;&amp;&gt;.txt/); assert.match(html, /端盖&lt;&amp;&gt; · R3/);
  assert.match(html, /上传时选择/); assert.match(html, /两步操作/);
  assert.doesNotMatch(html, /记录已提交|记录尚未提交/);
  const css = await readFile(new URL("../app/npd-v2.css", import.meta.url), "utf8");
  assert.match(css, /\.npd2-upload-receipt > div\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
});
