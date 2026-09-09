import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

// Exercise the real React component's callbacks in Node. No browser/DOM is used.
const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const hooksUrl = moduleUrl(`export const state={cursor:0,values:[]};
export function useState(initial){const i=state.cursor++;if(!(i in state.values))state.values[i]=initial;
return [state.values[i],value=>{state.values[i]=typeof value==='function'?value(state.values[i]):value;}];}
export function useRef(initial){const i=state.cursor++;return state.values[i]??=( {current:initial} );}`);
const source = await readFile(new URL("../app/components/npd/ProjectWorkspace.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("ProjectWorkspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const imports = { "react": hooksUrl,
  "react/jsx-runtime": pathToFileURL(createRequire(import.meta.url).resolve("react/jsx-runtime")).href };
for (const item of parsed.statements.filter(ts.isImportDeclaration)) {
  if (item.importClause.isTypeOnly || item.moduleSpecifier.text === "react") continue;
  const names = item.importClause.namedBindings.elements.filter((name) => !name.isTypeOnly).map((name) => name.name.text);
  imports[item.moduleSpecifier.text] = moduleUrl(names.map((name) => {
    if (name === "sheetByCode") return `export const sheetByCode={initiation:{shortTitle:'立项申请'},input_output:{shortTitle:'输入输出'}};`;
    if (name === "projectStatusLabels" || name === "sheetStatusLabels") return `export const ${name}={};`;
    if (name === "canEditSheet" || name === "isProjectSteward") return `export const ${name}=()=>true;`;
    return `export const ${name}=()=>null;`;
  }).join("\n"));
}
let compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const [name, target] of Object.entries(imports)) compiled = compiled.replaceAll(JSON.stringify(name), JSON.stringify(target));
const { ProjectWorkspace } = await import(moduleUrl(compiled));
const { state } = await import(hooksUrl);
function elements(node) {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
function setup(onUpload) {
  state.cursor = 0; state.values = ["initiation"];
  const project = { id: "project", name: "合成项目", code: "TEST", status: "active", seriesName: "测试", plannedStart: "2026-01-01", plannedEnd: "2026-12-31" };
  const snapshot = { motors: [], parts: [], activities: [], sheets: ["initiation", "input_output"].map((code, i) => ({ id: code, code, projectId: "project", sortOrder: i + 1 })) };
  const render = () => { state.cursor = 0; return elements(ProjectWorkspace({ project, snapshot, currentUser: { id: "test", name: "测试" }, signOutPath: "/api/local-auth/logout", onBack() {}, onAction() {}, onUpload })); };
  const select = (file) => {
    const input = render().find((node) => node.type === "input" && node.props.type === "file");
    input.props.ref.current = { value: file.name };
    return input.props.onChange({ target: { files: [file] } });
  };
  return { render, select };
}

test("stage upload failures are caught, retained and labelled with the original sheet and file", async () => {
  for (const error of [new Error("登录已失效，本次操作未执行。"), new Error("版本冲突"), new Error("Failed to fetch"), "unknown"]) {
    const calls = [];
    const fixture = setup(async (...args) => { calls.push(args); throw error; });
    const file = new File(["test"], "试验<原件>.txt");
    await assert.doesNotReject(() => fixture.select(file));
    const alert = fixture.render().find((node) => node.props?.role === "alert");
    assert.ok(alert); assert.match(alert.props.children.join(""), /立项申请.*试验<原件>\.txt/);
    assert.match(alert.props.children.join(""), /不会自动重传/);
    assert.equal(calls.length, 1); assert.equal(state.values[2], false);
    state.values[0] = "input_output";
    const afterSwitch = fixture.render().find((node) => node.props?.role === "alert");
    assert.match(afterSwitch.props.children.join(""), /立项申请/);
    assert.equal(calls[0][1].sheetCode, "initiation");
  }
});

test("repeated callbacks before a render send only one upload and keep the captured sheet", async () => {
  let finish; const calls = [];
  const fixture = setup((...args) => { calls.push(args); return new Promise((resolve) => { finish = resolve; }); });
  const file = new File(["test"], "same.txt");
  const first = fixture.select(file);
  assert.equal(state.values[2], true);
  state.values[0] = "input_output";
  await fixture.select(file);
  assert.equal(calls.length, 1); assert.equal(calls[0][1].sheetCode, "initiation");
  finish("document-id"); await first;
  assert.equal(state.values[2], false);
  assert.equal(fixture.render().some((node) => node.props?.role === "alert"), false);
});

test("a manual retry can select the same file and clears the old failure after success", async () => {
  let calls = 0;
  const fixture = setup(async () => { if (++calls === 1) throw new Error("附件上传失败"); return "saved-id"; });
  const file = new File(["test"], "retry.txt");
  await fixture.select(file);
  const input = fixture.render().find((node) => node.type === "input");
  assert.equal(input.props.ref.current.value, "");
  await fixture.select(file);
  assert.equal(calls, 2);
  assert.equal(fixture.render().some((node) => node.props?.role === "alert"), false);
});
