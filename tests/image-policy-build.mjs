import assert from "node:assert/strict";
import { lstat, realpath, writeFile, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

// This explicit negative build test accepts only the task's isolated candidate.
// It never creates malformed assets in the live checkout or uploads them.
const root = await realpath(process.argv[2] || ".");
assert.match(root, /^\/private\/tmp\/hengda-parser-mitigation-[A-Za-z0-9]+$/);
const app = path.join(root, "app");
assert.equal((await lstat(app)).isSymbolicLink(), false);
const file = path.join(app, "icon.png");
await writeFile(file, Buffer.from([105,99,110,115,0,0,0,16,105,99,48,56,0,0,0,0]), { flag: "wx" });
try {
  const child = spawn(process.execPath, [path.join(root, "node_modules/vinext/dist/cli.js"), "build"], {
    cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_WRITE_LOGS: "false" },
  });
  let logs = ""; let timedOut = false;
  const stop = () => { try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const timeout = setTimeout(() => { timedOut = true; stop(); }, 30000);
  const consume = (chunk) => { logs += chunk.toString(); if (logs.length > 256 * 1024) stop(); };
  child.stdout.on("data", consume); child.stderr.on("data", consume);
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timeout));
  assert.equal(timedOut, false, "malformed metadata must fail promptly, not be killed by the test");
  assert.equal(result.signal, null, logs.slice(-2500));
  assert.notEqual(result.code, 0, "malformed metadata must not produce a deployable build");
  assert.match(logs, /disabled file type: icns/);
  console.log("真实构建拒绝伪装为icon.png的ICNS异常内容：disabled file type: icns；未超时，未生成可发布版本。");
} finally {
  await unlink(file);
}
