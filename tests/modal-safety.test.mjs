import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

// Executes the actual callbacks; native focus isolation is separately browser-tested.
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const hooks = url(`export const state={cursor:0,values:[],effects:[],context:null};
export const createContext=()=>({Provider:()=>null});
export const useContext=()=>state.context;
export function useState(initial){const i=state.cursor++;if(!(i in state.values))state.values[i]=initial;return [state.values[i],v=>state.values[i]=typeof v==='function'?v(state.values[i]):v];}
export function useRef(initial){const i=state.cursor++;return state.values[i]??={current:initial};}
export function useEffect(callback){state.effects.push(callback);}`);
const source = await readFile(new URL("../app/components/npd/ui.tsx", import.meta.url), "utf8");
let code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
code = code.replaceAll(JSON.stringify("react"), JSON.stringify(hooks)).replaceAll(JSON.stringify("react/jsx-runtime"), JSON.stringify(pathToFileURL(createRequire(import.meta.url).resolve("react/jsx-runtime")).href));
const { Modal, ModalCancelButton } = await import(url(code));
const { state } = await import(hooks);
const elements = node => !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
function setup(props = {}) {
  state.values = []; state.context = null;
  let closed = 0;
  const child = { type: "form", props: { children: "未保存表单" } };
  const options = { title: "验收窗口", protectChanges: true, onClose() { closed++; }, children: child, ...props };
  const render = changes => {
    Object.assign(options, changes); state.cursor = 0; state.effects = [];
    const tree = Modal(options), nodes = elements(tree);
    const body = nodes.find(node => node.props?.onInputCapture);
    const context = nodes.find(node => node.props?.value?.requestClose)?.props.value;
    return { tree, nodes, body, context, closed: () => closed };
  };
  return { render, child };
}

test("close, cancel and Escape protect edited input; continue retains the same children; explicit discard closes once", () => {
  const oldDocument = globalThis.document, oldElement = globalThis.HTMLElement, oldFrame = globalThis.requestAnimationFrame;
  globalThis.document = { activeElement: null }; globalThis.HTMLElement = class {};
  const frames = []; globalThis.requestAnimationFrame = callback => frames.push(callback);
  try {
    const fixture = setup(); let view = fixture.render();
    view.body.props.onInputCapture(); view = fixture.render();
    state.context = view.context;
    ModalCancelButton({ onCancel() { assert.fail("must use guarded close"); } }).props.onClick();
    view = fixture.render(); assert.equal(view.closed(), 0); assert.equal(view.body.props.hidden, true);
    assert.ok(view.nodes.find(n => n.props?.role === "alertdialog"));
    let prevented = false;
    view.tree.props.onCancel({ preventDefault() { prevented = true; } });
    view = fixture.render(); assert.ok(prevented); assert.equal(view.body.props.hidden, false);
    assert.equal(view.body.props.children.props.children, fixture.child);
    view.nodes.find(n => n.props?.["aria-label"] === "关闭").props.onClick();
    view = fixture.render(); assert.equal(view.closed(), 0);
    view.nodes.find(n => n.type === "button" && n.props.children === "放弃修改并关闭").props.onClick();
    assert.equal(view.closed(), 1);
    frames.forEach(callback => callback());
  } finally { globalThis.document = oldDocument; globalThis.HTMLElement = oldElement; globalThis.requestAnimationFrame = oldFrame; }
});

test("saving blocks dismissal and editing; a failed save re-enables the retained form with the leave guard", () => {
  const fixture = setup(); let view = fixture.render(); view.body.props.onChangeCapture();
  view = fixture.render({ busy: true });
  assert.equal(view.body.props.inert, true); assert.equal(view.tree.props["aria-busy"], true);
  assert.ok(view.nodes.find(n => n.props?.role === "status"));
  view.context.requestClose(); view.tree.props.onCancel({ preventDefault() {} });
  const backdrop = {}; view.tree.props.onPointerDown({ target: backdrop, currentTarget: backdrop });
  view.tree.props.onClick({ target: backdrop, currentTarget: backdrop });
  assert.equal(view.closed(), 0);
  state.context = view.context; assert.equal(ModalCancelButton({ onCancel() {} }).props.disabled, true);
  view = fixture.render({ busy: false }); assert.equal(view.body.props.inert, false);
  assert.equal(view.body.props.children.props.children, fixture.child);
  assert.equal(view.tree.props["aria-busy"], false);
});

test("only a complete backdrop click dismisses a pristine window; reads never become dirty", () => {
  const fixture = setup({ protectChanges: false }); let view = fixture.render();
  view.body.props.onInputCapture(); view = fixture.render();
  const backdrop = {}, inside = {};
  view.tree.props.onPointerDown({ target: inside, currentTarget: backdrop });
  view.tree.props.onClick({ target: backdrop, currentTarget: backdrop }); assert.equal(view.closed(), 0);
  view.tree.props.onPointerDown({ target: backdrop, currentTarget: backdrop });
  view.tree.props.onClick({ target: backdrop, currentTarget: backdrop }); assert.equal(view.closed(), 1);
  assert.equal(view.body.props.hidden, false);
});

test("saving parks focus on the dialog heading and a rejected save returns it to the same control", () => {
  const oldElement = globalThis.HTMLElement; globalThis.HTMLElement = class {};
  const target = new globalThis.HTMLElement(); let focused = "";
  target.isConnected = true; target.focus = () => { focused = "submit"; };
  try {
    const fixture = setup(); let view = fixture.render();
    view.tree.props.ref.current = { contains: node => node === target };
    view.nodes.find(n => n.type === "h2").props.ref.current = { focus() { focused = "heading"; } };
    view.body.props.onFocusCapture({ target });
    view = fixture.render({ busy: true }); state.effects[3](); assert.equal(focused, "heading");
    view = fixture.render({ busy: false }); state.effects[3](); assert.equal(focused, "submit");
    view = fixture.render({ busy: true }); state.effects[3]();
    target.isConnected = false; view = fixture.render({ busy: false }); state.effects[3](); assert.equal(focused, "heading");
  } finally { globalThis.HTMLElement = oldElement; }
});

test("page-leave warning is conditional and cleans up; no draft or credential browser storage is introduced", () => {
  const oldWindow = globalThis.window; const listeners = new Map();
  globalThis.window = { addEventListener(name, handler) { listeners.set(name, handler); }, removeEventListener(name, handler) { assert.equal(listeners.get(name), handler); listeners.delete(name); } };
  try {
    const fixture = setup(); let view = fixture.render();
    assert.equal(state.effects[1](), undefined); assert.equal(listeners.size, 0);
    view.body.props.onInputCapture(); view = fixture.render();
    const cleanup = state.effects[1](); let prevented = false;
    const event = { returnValue: null, preventDefault() { prevented = true; } };
    listeners.get("beforeunload")(event); assert.ok(prevented); assert.equal(event.returnValue, "");
    cleanup(); assert.equal(listeners.size, 0);
    setup({ busy: true }).render(); const stop = state.effects[1](); assert.equal(listeners.size, 1); stop();
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/);
  } finally { globalThis.window = oldWindow; }
});

test("Tab wraps between current interactive controls and ignores disabled, hidden and inert content", () => {
  const previous = globalThis.document;
  let focused = null, prevented = false;
  const control = (name, changes = {}) => ({ name, tabIndex: 0, matches: () => false, closest: () => null, getClientRects: () => [1], focus() { focused = name; }, ...changes });
  const first = control("continue"), last = control("discard");
  const nodes = [control("disabled", { matches: () => true }), first, last, control("inert", { closest: () => ({}) }), control("hidden", { getClientRects: () => [] })];
  const { tree } = setup().render();
  const event = { key: "Tab", shiftKey: false, currentTarget: { querySelectorAll: () => nodes }, preventDefault() { prevented = true; } };
  try {
    globalThis.document = { activeElement: last }; tree.props.onKeyDown(event);
    assert.equal(focused, "continue"); assert.ok(prevented);
    focused = null; prevented = false; globalThis.document.activeElement = first;
    tree.props.onKeyDown({ ...event, shiftKey: true }); assert.equal(focused, "discard"); assert.ok(prevented);
    focused = null; prevented = false; tree.props.onKeyDown({ ...event, key: "Enter" });
    assert.equal(focused, null); assert.equal(prevented, false);
    globalThis.document.activeElement = {}; tree.props.onKeyDown(event); assert.equal(focused, "continue");
  } finally { globalThis.document = previous; }
});

test("all current editing dialogs opt into protection and busy state; structural edits and custom cancel buttons are wired", async () => {
  let count = 0;
  for (const file of ["Dialogs", "Customers", "MotorProduction", "OwnerTransferDialog", "Dashboard"]) {
    const text = await readFile(new URL(`../app/components/npd/${file}.tsx`, import.meta.url), "utf8");
    const parsed = ts.createSourceFile(`${file}.tsx`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(parsed) === "Modal") {
        count++; const attrs = node.attributes.properties;
        assert.ok(attrs.some(a => a.name?.text === "protectChanges"), file);
        assert.ok(attrs.some(a => a.name?.text === "busy" && a.initializer?.expression?.getText(parsed) === "busy"), file);
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    if (["Dialogs", "Dashboard"].includes(file)) assert.match(text, /<ModalCancelButton/);
    if (file === "Dialogs") {
      assert.match(text, /data-npd-edit onClick=\{\(\) => setMotors/);
      assert.match(text, /data-npd-edit onClick=\{\(\) => switchType/);
    }
  }
  assert.equal(count, 18);
});
