// Explicit diagnostic only: never imported by the application or npm test.
// Each parser runs in a disposable, memory-limited child for at most 250ms.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const parserPath = await realpath(process.argv[2]);
const sha256 = createHash("sha256").update(await readFile(parserPath)).digest("hex");
const code = `const parser = await import(process.argv[1]);
const input = Uint8Array.from(Buffer.from(process.argv[2], 'hex'));
process.stdout.write('probe-ready\\n');
try { const result = (parser.imageSize || parser.default)(input);
  console.log(JSON.stringify({result}));
} catch(error) { console.log(JSON.stringify({rejected:error.message})); }`;
const samples = {
  validSvg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>'),
  // CVE-2025-71330: a single ICNS entry with a zero length cannot advance.
  zeroLengthIcns: Buffer.from([105, 99, 110, 115, 0, 0, 0, 16, 105, 99, 48, 56, 0, 0, 0, 0]),
};
const results = {};
for (const [name, bytes] of Object.entries(samples)) {
  const run = spawnSync(process.execPath, ["--max-old-space-size=32", "--input-type=module", "-e", code,
    pathToFileURL(parserPath).href, bytes.toString("hex")], {
    timeout: 250, killSignal: "SIGKILL", encoding: "utf8", maxBuffer: 4096,
  });
  assert.ok(run.stdout?.includes("probe-ready\n"), "parser did not reach the probe; result is inconclusive");
  results[name] = { exitCode: run.status, signal: run.signal, errorCode: run.error?.code || null, timedOut: run.error?.code === "ETIMEDOUT",
    output: run.stdout.trim().split("\n").slice(1).join("\n") };
}
assert.equal(results.validSvg.exitCode, 0);
assert.equal(JSON.parse(results.validSvg.output).result.width, 1);
console.log(JSON.stringify({ parserPath, sha256, results,
  scope: "isolated bounded ICNS parser diagnostic, not an HTTP reachability or whole-system safety test" }, null, 2));
