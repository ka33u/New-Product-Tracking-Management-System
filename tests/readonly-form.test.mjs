import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const runtime = pathToFileURL(require.resolve("react/jsx-runtime")).href;
async function compile(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [name, url] of Object.entries({ react: pathToFileURL(require.resolve("react")).href, "react/jsx-runtime": runtime, ...imports })) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}
const formsUrl = await compile("../lib/forms.ts");
const uiUrl = await compile("../app/components/npd/ui.tsx");
const { formDefinitions } = await import(formsUrl);
const { ReadOnlyForm, displayFormValue } = await import(await compile("../app/components/npd/ReadOnlyForm.tsx", {
  "../../../lib/forms": formsUrl, "./ui": uiUrl,
}));

test("all ten forms render all defined fields without editing controls", () => {
  for (const definition of formDefinitions) {
    const html = renderToStaticMarkup(React.createElement(ReadOnlyForm, { projectCode: "NP-TEST", formCode: definition.code, onClose() {} }));
    assert.ok(html.includes(definition.name));
    for (const field of definition.fields) assert.ok(html.includes(field.label), `${definition.code} missing ${field.label}`);
    assert.match(html, /尚未填写/);
    assert.doesNotMatch(html, /<(input|textarea|select|form)[\s>]/);
    assert.doesNotMatch(html, /保存草稿|提交受控版本/);
  }
});
test("read-only rendering preserves zero, false, multiline and unknown fields and escapes markup", () => {
  assert.equal(displayFormValue(0), "0");
  assert.equal(displayFormValue(false), "否");
  assert.equal(displayFormValue([]), "未选择");
  assert.equal(displayFormValue(["甲", "乙"]), "甲、乙");
  const definition = formDefinitions[0];
  const html = renderToStaticMarkup(React.createElement(ReadOnlyForm, { projectCode: "NP-TEST", formCode: definition.code,
    record: { version: 2, status: "draft", updatedByName: "张工", updatedAt: "2026-09-06 10:00:00",
      payload: { [definition.fields[0].key]: "第一行\n第二行", legacy: "<script>alert(1)</script>" } }, onClose() {} }));
  assert.match(html, /草稿（未正式提交）/);
  assert.match(html, /第一行\n第二行/);
  assert.match(html, /其他已保存字段/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
