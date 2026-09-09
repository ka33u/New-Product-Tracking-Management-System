import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const moduleUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
async function compile(file, imports = {}) {
  let code = ts.transpileModule(await readFile(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(name), JSON.stringify(url));
  return moduleUrl(code);
}
const authUrl = await compile("../lib/auth-required.ts");
const { NpdAuthenticationRequiredError, authenticationRequiredResponse, writeFailureMessage } = await import(authUrl);

test("only typed authentication failures become private401, never generic permission/storage errors", async () => {
  const result = authenticationRequiredResponse(new NpdAuthenticationRequiredError());
  assert.equal(result.status, 401);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal((await result.json()).code, "AUTH_REQUIRED");
  for (const error of [new Error("无权操作"), new Error("数据库失败"), new Error("请先登录"),
    { name: "NpdAuthenticationRequiredError" }, null]) assert.equal(authenticationRequiredResponse(error), null);
});

test("failed-write login copy distinguishes unsaved input from validation/conflict/network errors", () => {
  const message = writeFailureMessage(401, "generic", "保存失败");
  for (const text of ["本次操作未执行", "复制留存", "重新登录", "未保存内容"]) assert.ok(message.includes(text));
  assert.doesNotMatch(message, /已自动保存|已保存到/);
  for (const status of [400, 403, 409, 500, 503]) {
    assert.equal(writeFailureMessage(status, "原始错误", "默认错误"), "原始错误");
    assert.equal(writeFailureMessage(status, undefined, "默认错误"), "默认错误");
  }
});

const stubUrl = moduleUrl(`export const state = { mode: 'local', local: null, hosted: null, cookie: null };
export function getNpdRuntimeEnv() { return { NPD_AUTH_MODE: state.mode }; }
export async function headers() { return new Headers(state.cookie ? { cookie: state.cookie } : {}); }
export async function resolveNpdLocalSession() { if (state.failure) throw state.failure; return state.local; }
export async function getChatGPTUser() { return state.hosted; }
export async function resolveNpdCurrentUser() { return state.hosted; }`);
const { state } = await import(stubUrl);
const { requireNpdRequestUser } = await import(await compile("../app/request-user.ts", {
  "next/headers": stubUrl, "../db/store-v2": stubUrl, "./chatgpt-auth": stubUrl, "../lib/auth-required": authUrl,
}));
test("the request guard emits the typed error only when identity is absent and preserves authenticated users", async () => {
  for (const mode of ["local", "chatgpt"]) {
    state.mode = mode;
    await assert.rejects(requireNpdRequestUser, NpdAuthenticationRequiredError);
  }
  state.mode = "local";
  state.local = { id: "staff", active: true };
  assert.equal(await requireNpdRequestUser(), state.local);
  state.failure = new Error("storage unavailable");
  await assert.rejects(requireNpdRequestUser, (error) => error === state.failure);
  delete state.failure;
});
