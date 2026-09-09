import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const url = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
async function compile(file, imports = {}) {
  let code = ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [name, target] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(name), JSON.stringify(target));
  return url(code);
}
const identityUrl = await compile("../lib/workspace-identity.ts");
const authUrl = await compile("../lib/auth-required.ts");
const feedbackUrl = await compile("../lib/write-feedback.ts", { "./auth-required": authUrl, "./workspace-identity": identityUrl });
const { checkWorkspaceActor, assertWorkspaceIdentity, ACTOR_CONTEXT_CHANGED } = await import(identityUrl);

test("actor precondition requires an exact authenticated id; missing, repeated and different identities fail closed", async () => {
  for (const value of [null, "", "bob", "alice,bob"]) {
    const request = new Request("http://localhost/api/action", { headers: value === null ? {} : { "x-npd-actor": value } });
    const response = checkWorkspaceActor(request, "alice");
    assert.equal(response.status, 409); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).code, ACTOR_CONTEXT_CHANGED);
  }
  assert.equal(checkWorkspaceActor(new Request("http://localhost", { headers: { "X-NPD-Actor": "alice" } }), "alice"), null);
  assert.doesNotThrow(() => assertWorkspaceIdentity("alice", "alice"));
  for (const id of [undefined, "", "bob"]) assert.throws(() => assertWorkspaceIdentity("alice", id), /账号/);
});

test("both write routes reject mismatched actors before parsing or invoking storage", async () => {
  for (const route of ["action", "files"]) {
    const source = await readFile(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
    const parsed = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
    const storeImport = parsed.statements.find((node) => ts.isImportDeclaration(node) && node.moduleSpecifier.text.endsWith("db/store-v2"));
    const exports = storeImport.importClause.namedBindings.elements.map((node) => node.name.text);
    const stub = url(`export const state={calls:0}; export const NextResponse={json:Response.json};
      export class NpdConflictError extends Error {}
      export const sheetByCode={}; export const isSameOriginMutation=()=>true;
      export const isLocalNpdMode=()=>true; export const requireNpdRequestUser=async()=>({id:'bob'});
      ${exports.map((name) => `export function ${name}(){state.calls++;throw new Error('storage invoked');}`).join("\n")}`);
    const mappings = Object.fromEntries(parsed.statements.filter(ts.isImportDeclaration)
      .map((node) => [node.moduleSpecifier.text, node.moduleSpecifier.text.endsWith("workspace-identity") ? identityUrl
        : node.moduleSpecifier.text.endsWith("auth-required") ? authUrl : stub]));
    const { POST } = await import(await compile(`../app/api/${route}/route.ts`, mappings));
    const request = new Request(`http://localhost/api/${route}`, { method: "POST", headers: { "X-NPD-Actor": "alice" }, body: "invalid-body" });
    assert.equal((await POST(request)).status, 409);
    assert.equal(request.bodyUsed, false, "context rejection must precede JSON/multipart parsing");
    assert.equal((await import(stub)).state.calls, 0, "no database call or R2 put/delete may occur");
  }
});

// Invoke the real workspace's callback closures in Node, without a browser/DOM.
// State setters are observed so a rejected refresh cannot silently swap owners
// or replace the snapshot beneath an open editor. This is not browser UI QA.
const hooksUrl = url(`export const state={cursor:0,values:[],writes:[],refCursor:0,refs:[],effects:[]};
  export function useState(initial){ const i=state.cursor++;
    if(!(i in state.values)) state.values[i]=i===3?'p':initial;
    return [state.values[i],next=>{state.writes.push(i);state.values[i]=next;}]; }
  export const useMemo=fn=>fn();
  // Callback isolation does not mount a DOM. Navigation's effects/refs must
  // exist, but effects are not run by this render-only harness.
  export const useEffect=effect=>state.effects.push(effect);
  export const useRef=initial=>state.refs[state.refCursor++] ||= {current:initial};`);
const componentStub = url(`export const projectStatusLabels={},roleLabels={},sheetStatusLabels={},sheetByCode={};
  export const canCreateProject=()=>true,stageAssignment=()=>({}),buildTaskModel=()=>({pending:[]}),businessDate=()=> '2026-09-07';
  export const validBusinessDate=()=>true,formatDate=value=>value,formatDateTime=value=>value;
  export function ProjectWorkspace(){} export function Tasks(){} export function Dashboard(){}
  export function CustomerDialog(){} export function Customers(){} export function CreateProjectDialog(){}
  export function CreateUserDialog(){} export function LinkOrderDialog(){} export function SalesOrderDialog(){} export function UserDialog(){}
  export function EmptyState(){} export function Icon(){} export function ProgressBar(){} export function StatusBadge(){}`);
const workspaceSource = await readFile(new URL("../app/components/NpdWorkspace.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("NpdWorkspace.tsx", workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const mappings = Object.fromEntries(parsed.statements.filter(ts.isImportDeclaration).map((node) => [node.moduleSpecifier.text,
  node.moduleSpecifier.text === "react" ? hooksUrl : node.moduleSpecifier.text.endsWith("workspace-identity") ? identityUrl
    : node.moduleSpecifier.text.endsWith("auth-required") ? authUrl
      : node.moduleSpecifier.text.endsWith("write-feedback") ? feedbackUrl : componentStub]));
mappings["react/jsx-runtime"] = pathToFileURL(createRequire(import.meta.url).resolve("react/jsx-runtime")).href;
const { NpdWorkspace } = await import(await compile("../app/components/NpdWorkspace.tsx", mappings));
const { state } = await import(hooksUrl);

function callbacks(t, responses) {
  state.cursor = 0; state.values = []; state.writes = []; state.refCursor = 0; state.refs = []; state.effects = [];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (route, options) => {
    calls.push({ route, options });
    const next = responses.shift(); assert.ok(next, `unexpected request ${route}`);
    if (next.error) throw next.error;
    if ("raw" in next) return new Response(next.raw, { status: next.status });
    return Response.json(next.body, { status: next.status });
  });
  const oldWindow = globalThis.window;
  const timers = new Map(); const cleared = []; let timerId = 0;
  globalThis.window = { setTimeout: (fn) => { const id = timerId++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { cleared.push(id); timers.delete(id); } };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  const initialSnapshot = { projects: [{ id: "p" }] };
  const render = () => {
    state.cursor = 0; state.refCursor = 0;
    return NpdWorkspace({ currentUser: { id: "alice" }, initialSnapshot, signOutPath: "/api/local-auth/logout" });
  };
  const result = render();
  const cleanups = state.effects.map(effect => effect()).filter(Boolean);
  return { ...result.props.children[0].props, calls, initialSnapshot, timers, cleared, render,
    unmount: () => cleanups.forEach(cleanup => cleanup()) };
}

test("context conflicts preserve the current account and snapshot without a refresh or automatic retry", async (t) => {
  const c = callbacks(t, [{ status: 409, body: { code: ACTOR_CONTEXT_CHANGED, error: "账号已改变" } }]);
  await assert.rejects(() => c.onAction("save_form", { draft: "keep" }), /账号.*不一致/);
  assert.equal(c.calls.length, 1);
  assert.equal(new Headers(c.calls[0].options.headers).get("X-NPD-Actor"), "alice");
  assert.equal(state.writes.includes(0) || state.writes.includes(1), false);
  assert.equal(state.values[0], c.initialSnapshot);
});

test("a normal version-conflict refresh may not replace the editor with a different account's snapshot", async (t) => {
  const c = callbacks(t, [{ status: 409, body: { error: "版本冲突" } },
    { status: 200, body: { currentUser: { id: "bob" }, snapshot: { projects: [] } } }]);
  await assert.rejects(() => c.onAction("save_form", {}), /版本冲突/);
  assert.equal(c.calls.length, 2);
  assert.equal(state.writes.includes(0) || state.writes.includes(1), false);
});

test("a saved write remains successful if identity changes before refresh, with no account swap or repeat", async (t) => {
  const c = callbacks(t, [{ status: 200, body: { ok: true, result: { id: "saved" } } },
    { status: 200, body: { currentUser: { id: "bob" }, snapshot: { projects: [] } } }]);
  assert.deepEqual(await c.onAction("save_form", {}), { id: "saved" });
  assert.equal(c.calls.length, 2);
  assert.equal(state.writes.includes(0) || state.writes.includes(1), false);
  assert.match(state.values.find((value) => value?.message)?.message, /已保存.*不要重复提交/);
});

test("uploads also bind to the visible account, while same-account refreshes still update the workspace", async (t) => {
  const c = callbacks(t, [{ status: 409, body: { code: ACTOR_CONTEXT_CHANGED, error: "账号已改变" } },
    { status: 200, body: { ok: true, result: null } },
    { status: 200, body: { currentUser: { id: "alice", name: "新姓名" }, snapshot: { projects: [{ id: "p" }] } } }]);
  await assert.rejects(() => c.onUpload(new File(["test"], "test.txt"), { projectId: "p", sheetCode: "input_output", kind: "attachment" }), /账号.*不一致/);
  assert.equal(new Headers(c.calls[0].options.headers).get("X-NPD-Actor"), "alice");
  assert.equal(c.calls.length, 1);
  await c.onAction("save_form", {});
  assert.equal(state.values[1].id, "alice"); assert.equal(state.values[1].name, "新姓名");
  assert.deepEqual(state.values[0], { projects: [{ id: "p" }] });
});

const savedReply = () => ({ status: 200, body: { ok: true, result: { id: "saved" }, id: "document-saved" } });
const ownRefresh = () => ({ status: 200, body: { currentUser: { id: "alice" }, snapshot: { projects: [{ id: "p" }] } } });
const invoke = (c, upload) => upload
  ? c.onUpload(new File(["synthetic"], "验收.txt"), { projectId: "p", sheetCode: "verification", kind: "attachment" })
  : c.onAction("update_user", { draft: "keep" });
const notice = () => state.values[11];

test("saved actions and uploads distinguish expired login, changed actor and unreadable refresh", async (t) => {
  for (const upload of [false, true]) for (const scenario of ["expired", "changed", "offline", "invalid-json"]) await t.test(`${upload ? "upload" : "action"}: ${scenario}`, async (t) => {
    const refresh = scenario === "expired" ? { status: 401, raw: "not JSON" }
      : scenario === "changed" ? { status: 200, body: { currentUser: { id: "bob" }, snapshot: { projects: [] } } }
        : scenario === "offline" ? { error: new TypeError("network lost") } : { status: 200, raw: "broken" };
    const c = callbacks(t, [savedReply(), refresh]);
    assert.deepEqual(await invoke(c, upload), upload ? "document-saved" : { id: "saved" });
    assert.equal(c.calls.length, 2, "exactly one write and one refresh, no retry");
    assert.equal(state.writes.includes(0) || state.writes.includes(1), false);
    assert.equal(notice().type, "warning"); assert.equal(notice().persistent, true);
    assert.equal(c.timers.size, 0);
    assert.equal(notice().title, scenario === "expired" ? "已保存，需重新登录" : scenario === "changed" ? "已保存，请确认账号" : "已保存，页面待更新");
    assert.match(notice().message, upload ? /附件已上传.*不要重复上传/ : /本次操作已保存.*不要重复提交/);
    assert.doesNotMatch(notice().message, /本次操作未执行|自动保存/);
    assert.equal(c.render().props.children[0].props.currentUser.id, "alice");
    c.render().props.children[1].props.onDismiss();
    assert.equal(notice(), null);
  });
});

test("known authentication or actor rejections retain input, persist notice and never refresh", async (t) => {
  for (const upload of [false, true]) for (const status of [401, 409]) await t.test(`${upload ? "upload" : "action"}: ${status}`, async (t) => {
    const c = callbacks(t, [{ status, body: { code: status === 409 ? ACTOR_CONTEXT_CHANGED : "AUTH_REQUIRED", error: "short server message" } }]);
    await assert.rejects(() => invoke(c, upload), /本次操作未执行/);
    assert.equal(c.calls.length, 1); assert.equal(c.timers.size, 0);
    assert.equal(notice().persistent, true); assert.equal(notice().type, "error");
    assert.equal(notice().title, "本次操作未执行");
    assert.match(notice().message, /复制留存/);
    assert.equal(state.values[0], c.initialSnapshot);
    assert.equal(state.writes.includes(0) || state.writes.includes(1), false);
  });
});

test("lost, malformed and server-error write responses are unconfirmed, not automatically resubmitted", async (t) => {
  for (const upload of [false, true]) for (const response of [
    { error: new TypeError("Failed to fetch") }, { status: 200, raw: "truncated" },
    { status: 200, body: null }, { status: 200, body: { unexpected: true } },
    { status: 503, raw: "Service unavailable" },
  ]) await t.test(`${upload ? "upload" : "action"}: ${JSON.stringify(response)}`, async (t) => {
    const c = callbacks(t, [response]);
    await assert.rejects(() => invoke(c, upload), /未能确认服务器是否已保存/);
    assert.equal(c.calls.length, 1); assert.equal(c.timers.size, 0);
    assert.equal(notice().title, "结果待核对"); assert.equal(notice().type, "warning");
    assert.equal(notice().persistent, true); assert.doesNotMatch(notice().message, /本次操作未执行|本次操作已保存/);
    assert.equal(state.values[0], c.initialSnapshot);
  });
});

test("a successful upload without its document id is unconfirmed and leaves the caller open", async (t) => {
  const c = callbacks(t, [{ status: 200, body: { ok: true } }]);
  await assert.rejects(() => invoke(c, true), /未能确认/);
  assert.equal(c.calls.length, 1); assert.equal(notice().title, "结果待核对");
});

test("new notices cancel old timer including id zero; dismiss and unmount clean up", async (t) => {
  const c = callbacks(t, [savedReply(), ownRefresh(), { status: 401, body: {} },
    savedReply(), ownRefresh(), savedReply(), ownRefresh(), savedReply(), ownRefresh()]);
  await invoke(c, false); assert.deepEqual([...c.timers.keys()], [0]);
  await assert.rejects(() => invoke(c, false));
  assert.deepEqual(c.cleared, [0]); assert.equal(c.timers.size, 0);
  assert.equal(notice().persistent, true);
  c.render().props.children[1].props.onDismiss(); assert.equal(notice(), null);
  await invoke(c, false); assert.equal(c.timers.size, 1);
  await invoke(c, false); assert.equal(c.timers.size, 1); assert.deepEqual(c.cleared, [0, 1]);
  const callback = [...c.timers.values()][0]; callback(); assert.equal(notice(), null);
  c.timers.clear();
  await invoke(c, false); assert.equal(c.timers.size, 1);
  c.unmount(); assert.equal(c.timers.size, 0);
});

test("validation errors retain server explanation and normal conflicts still refresh once", async (t) => {
  const c = callbacks(t, [{ status: 400, body: { error: "请填写变更原因" } },
    { status: 409, body: { error: "版本冲突" } }, ownRefresh()]);
  await assert.rejects(() => invoke(c, false), /请填写变更原因/);
  assert.equal(notice().type, "error"); assert.equal(c.calls.length, 1);
  await assert.rejects(() => invoke(c, false), /版本冲突/);
  assert.equal(c.calls.length, 3); assert.equal(state.values[1].id, "alice");
});
