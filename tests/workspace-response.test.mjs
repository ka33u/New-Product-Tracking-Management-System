import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const stubUrl = moduleUrl(`export const state = { user: null, snapshot: null, reads: 0 };
export async function getNpdRequestUser() { if (state.authError) throw new Error(state.authError); return state.user; }
export async function getNpdWorkspaceSnapshot() { state.reads++; return state.snapshot; }
export const NextResponse = { json: (value, init) => Response.json(value, init) };`);
let code = ts.transpileModule(await readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
for (const specifier of ["next/server", "../../request-user", "../../../db/store-v2"]) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(stubUrl));
const { state } = await import(stubUrl);
const { GET } = await import(moduleUrl(code));

test("未登录或已撤销会话返回401与登录提示，不读取业务数据，不缓存", async () => {
  state.user = null; state.reads = 0;
  const result = await GET();
  assert.equal(result.status, 401); assert.equal(result.headers.get("cache-control"), "no-store");
  const body = await result.json(); assert.equal(body.code, "AUTH_REQUIRED");
  assert.match(body.error, /重新登录/); assert.doesNotMatch(body.error, /初始化/);
  assert.equal(state.reads, 0); assert.equal(body.snapshot, undefined);
});
test("返回同一工作区读取中的当前姓名与角色，不沿用认证前的旧账户资料", async () => {
  state.user = { id: "user", name: "旧姓名", role: "admin" };
  state.snapshot = { users: [{ id: "user", name: "新姓名", role: "sales", active: true }], projects: [] };
  const result = await GET(); const body = await result.json();
  assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(body.currentUser, state.snapshot.users[0]); assert.deepEqual(body.snapshot, state.snapshot);
});
