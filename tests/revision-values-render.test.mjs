import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import test from "node:test";

test("version business fields and form labels are readable while original values and unknown extensions remain available", async () => {
  const require = createRequire(import.meta.url);
  const imports = { "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href };
  async function compile(file, key) {
    let source = ts.transpileModule(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    for (const [name, url] of Object.entries(imports)) source = source.replaceAll(JSON.stringify(name), JSON.stringify(url));
    const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
    if (key) imports[key] = url;
    return import(url);
  }
  const { formDefinitions } = await compile("lib/forms.ts", "../../../lib/forms");
  await compile("lib/revision-view.ts", "../../../lib/revision-view");
  const { RevisionValues } = await compile("app/components/npd/RevisionValues.tsx");
  const render = (value) => renderToStaticMarkup(React.createElement(RevisionValues, { value }));
  const row = Object.freeze({ id: "m1", model: "QA<&>", confirmed_by: "historical-user-id", confirmed_at: "2026-09-08 02:26:04",
    production_note: "第一行\n第二行<&>", status: "blocked", actual_date: null, legacy_flag: false, quantity: 0, legacy_empty: "" });
  const html = render(row);
  for (const text of ["生产确认人（历史标识）", "historical-user-id", "生产确认时间", "2026-09-08 10:26:04（北京时间）", "生产确认说明", "第二行&lt;&amp;&gt;", "受阻", "未记录", "legacy_flag", "否", "未填写", "查看字段原值（未转换时间与状态）"]) assert.ok(html.includes(text), text);
  assert.match(html, /<dd>0<\/dd>/); assert.doesNotMatch(html, /<script/);
  assert.ok(html.includes("2026-09-08 02:26:04"), "raw UTC value must still be available");
  assert.ok(html.includes("&quot;status&quot;: &quot;blocked&quot;"), "raw enum must remain available");
  assert.match(render(undefined), /此版本中无该记录/);
  const form = formDefinitions[0], field = form.fields[0];
  const payload = { [field.key]: "QA表单内容", legacy_extra: "旧扩展<&>", zero: 0, flag: false, list: ["甲", "乙"] };
  const formHtml = render({ form_code: form.code, payload });
  for (const text of [field.label, "QA表单内容", "legacy_extra", "旧扩展&lt;&amp;&gt;", "甲、乙"]) assert.ok(formHtml.includes(text), text);
  assert.match(formHtml, /<dd>0<\/dd>/); assert.match(formHtml, /<dd>否<\/dd>/);
  assert.match(render({ form_code: "UNKNOWN", payload: "{invalid-json" }), /\{invalid-json/);
});
