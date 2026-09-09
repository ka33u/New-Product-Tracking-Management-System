import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
const source = await readFile(new URL("../lib/request-security.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { isSameOriginMutation } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const request = (headers) => new Request("http://localhost:3011/api/action", { method: "POST", headers, body: "{}" });
test("cookie writes require the exact origin, including port and protocol", () => {
  for (const headers of [{}, { origin: "null" }, { origin: "http://localhost:3012" }, { origin: "https://localhost:3011" },
    { origin: "http://localhost:3011.evil.test" }, { origin: "http://localhost:3011/" },
    { origin: "http://attacker.test", "x-forwarded-host": "attacker.test", "x-forwarded-proto": "http" }]) assert.equal(isSameOriginMutation(request(headers)), false);
  assert.equal(isSameOriginMutation(request({ origin: "http://localhost:3011" })), true);
  assert.equal(isSameOriginMutation(request({ origin: "http://localhost:3011", "sec-fetch-site": "same-origin" })), true);
  for (const site of ["cross-site", "same-site"]) assert.equal(isSameOriginMutation(request({ origin: "http://localhost:3011", "sec-fetch-site": site })), false);
});
