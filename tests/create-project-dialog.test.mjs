import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Execute the real component's callbacks with isolated hooks and an insecure-
// context Crypto double. This is a component regression, not browser/Windows QA.
const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/components/npd/Dialogs.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Dialogs.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["CreateProjectDialog", "RoleSelect"].includes(node.name?.text));
assert.equal(selected.length, 2);
const code = ts.transpileModule(selected.map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const elements = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];

for (const crypto of [{ getRandomValues() { assert.fail("draft keys must not need crypto"); } }, undefined]) {
  test(`project dialog edits/adds/removes/submits rows without randomUUID (crypto ${crypto ? "HTTP" : "absent"})`, async () => {
    const hooks = { cursor: 0, values: [] }, module = { exports: {} };
    const useState = initial => {
      const i = hooks.cursor++;
      if (!(i in hooks.values)) {
        if (typeof initial === "function") initial(); // Strict Mode's discarded call.
        hooks.values[i] = typeof initial === "function" ? initial() : initial;
      }
      return [hooks.values[i], value => {
        if (typeof value === "function") value(hooks.values[i]);
        hooks.values[i] = typeof value === "function" ? value(hooks.values[i]) : value;
      }];
    };
    const useRef = initial => { const i = hooks.cursor++; return hooks.values[i] ??= { current: initial }; };
    const bindings = { crypto, useState, useRef, addDays: () => "2026-12-10", today: () => "2026-09-10", getFormObject: form => form.raw };
    for (const name of ["Modal", "Field", "Icon", "SubmitBar"]) bindings[name] = () => null;
    new Function("require", "exports", ...Object.keys(bindings), code)(require, module.exports, ...Object.values(bindings));
    let submitted, closed = 0;
    const render = () => { hooks.cursor = 0; return module.exports.CreateProjectDialog({ snapshot: { orders: [], users: [], customers: [] },
      onClose() { closed++; }, async onAction(kind, payload) { submitted = { kind, payload }; } }); };
    const rows = tree => elements(tree).filter(n => n.props?.className === "npd2-motor-editor");
    const add = tree => elements(tree).find(n => n.type === "button" && elements(n).some(c => c.props?.children?.includes?.("增加规格"))).props.onClick();
    const input = (row, label) => elements(row).find(n => n.props?.label === label).props.children;
    let tree = render();
    assert.equal(rows(tree).length, 1);
    const firstKey = rows(tree)[0].key;
    for (let i = 0; i < 5; i++) tree = render();
    input(rows(tree)[0], "型号规格").props.onChange({ target: { value: "Y-100" } });
    tree = render(); assert.equal(rows(tree)[0].key, firstKey);
    assert.equal(input(rows(tree)[0], "型号规格").props.value, "Y-100");
    add(tree); tree = render(); add(tree); tree = render();
    assert.deepEqual(rows(tree).map(n => n.key), ["draft-motor-0", "draft-motor-1", "draft-motor-2"]);
    const removed = rows(tree)[1].key;
    elements(rows(tree)[1]).find(n => n.type === "button" && n.props.children === "移除").props.onClick();
    tree = render(); add(tree); tree = render();
    const keys = rows(tree).map(n => n.key);
    assert.equal(new Set(keys).size, 3); assert.ok(!keys.includes(removed));
    assert.equal(input(rows(tree)[0], "型号规格").props.value, "Y-100");
    await elements(tree).find(n => n.type === "form").props.onSubmit({ preventDefault() {}, currentTarget: { raw: { name: "合成项目" } } });
    assert.equal(closed, 1); assert.equal(submitted.kind, "create_project");
    assert.equal(submitted.payload.motors.length, 3);
    assert.equal(submitted.payload.motors[0].model, "Y-100");
    assert.ok(submitted.payload.motors.every(m => !("id" in m)));
  });
}
