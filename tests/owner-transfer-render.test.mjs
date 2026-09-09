import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import test from "node:test";

test("交接窗口显示基准负责人、职责及限制，只列启用可接任账户", async () => {
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
  await compile("lib/sheets-v2.ts", "./sheets-v2");
  await compile("lib/access-v2.ts", "../../../lib/access-v2");
  await compile("app/components/npd/ui.tsx", "./ui");
  const { OwnerTransferDialog } = await compile("app/components/npd/OwnerTransferDialog.tsx");
  const project = { id: "project", code: "P01", ownerId: "old", ownerName: "原负责人<&>", ownershipVersion: 7, lifecycleVersion: 2 };
  const users = [
    { id: "old", name: "原负责人", role: "design", active: true },
    { id: "sales", name: "可接任销售", role: "sales", active: true },
    { id: "disabled", name: "已停用设计", role: "design", active: false },
    { id: "quality", name: "质量角色", role: "quality", active: true },
  ];
  const props = { project, snapshot: { users, members: [{ id: "member", projectId: "project", userId: "old", responsibility: "项目总负责人", version: 3 }] },
    onClose() {}, onAction() {} };
  const html = renderToStaticMarkup(React.createElement(OwnerTransferDialog, props));
  assert.match(html, /交接版本 V7/); assert.match(html, /原负责人&lt;&amp;&gt;/);
  assert.match(html, /可接任销售/); assert.doesNotMatch(html, /已停用设计|质量角色/);
  assert.match(html, /原负责人保留项目成员身份/); assert.match(html, /交接协作，按当前角色参与项目/);
  assert.match(html, /disabled="">确认交接/); assert.doesNotMatch(html, /处理中/);
  const empty = renderToStaticMarkup(React.createElement(OwnerTransferDialog, { ...props, snapshot: { ...props.snapshot, users: users.slice(0, 1) } }));
  assert.match(empty, /没有可接任的启用账户/);
});
