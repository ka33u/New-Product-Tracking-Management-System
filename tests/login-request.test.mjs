import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const code = ts.transpileModule(await readFile(new URL("../lib/login-request.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { readLoginForm, localLoginErrorResponse } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const url = "http://localhost:3011/api/local-auth/login";
test("login form bounds actual bytes, not just a trusted Content-Length", async () => {
  const normal = new Request(url, { method: "POST", body: new URLSearchParams({ mode: "setup", name: "测试", password: "Password2026" }) });
  assert.equal((await readLoginForm(normal)).get("name"), "测试");
  const prefix = "mode=login&x=";
  const boundary = new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: prefix + "a".repeat(8192 - prefix.length) });
  assert.equal((await readLoginForm(boundary)).get("mode"), "login");
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(5000)); }, cancel() { cancelled = true; } });
  const large = new Request(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "10" }, body: stream, duplex: "half" });
  await assert.rejects(() => readLoginForm(large), (error) => error.status === 413);
  assert.equal(cancelled, true);
  for (const headers of [{ "Content-Type": "application/json" }, { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "8193" }]) {
    await assert.rejects(() => readLoginForm(new Request(url, { method: "POST", headers, body: "{}" })), (error) => [413, 415].includes(error.status));
  }
  await assert.rejects(() => readLoginForm(new Request(url, { method: "POST", body: new URLSearchParams({ mode: "unknown" }) })), (error) => error.status === 400);
});
test("rate limit responses are uncached, accessible HTML or structured JSON", async () => {
  const html = localLoginErrorResponse(new Request(url, { headers: { Accept: "text/html" } }), 429, '<script>"test"</script>', 120);
  assert.equal(html.status, 429);
  assert.equal(html.headers.get("retry-after"), "120");
  assert.equal(html.headers.get("cache-control"), "no-store");
  const body = await html.text();
  assert.match(body, /返回登录页/); assert.match(body, /role="alert"/); assert.doesNotMatch(body, /<script>/);
  const json = localLoginErrorResponse(new Request(url), 429, "稍后重试", 120);
  assert.deepEqual(await json.json(), { error: "稍后重试", retryAfterSeconds: 120 });
});
