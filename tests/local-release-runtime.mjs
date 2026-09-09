import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, copyFile, readFile, writeFile, readdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { prepareRelease, activateRelease, activeRelease } from "../scripts/local-release.mjs";
import { localMigrationNames } from "../scripts/local-migrations.mjs";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "hengda-release-runtime-"));
await cp(path.join(project, "dist"), path.join(root, "dist"), { recursive: true });
await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "drizzle"));
for (const file of ["local-server.mjs", "local-runtime.mjs", "local-release.mjs", "local-migrations.mjs"]) {
  await copyFile(path.join(project, "scripts", file), path.join(root, "scripts", file));
}
for (const name of localMigrationNames) await copyFile(path.join(project, "drizzle", `${name}.sql`), path.join(root, "drizzle", `${name}.sql`));
for (const file of ["package.json", "package-lock.json"]) await copyFile(path.join(project, file), path.join(root, file));
await symlink(path.join(project, "node_modules"), path.join(root, "node_modules"), "dir");
const release = await prepareRelease(root); await activateRelease(release.id, root);
const asset = (await readdir(path.join(root, "dist/client/assets"))).find((name) => name.endsWith(".css"));
assert.ok(asset);
const expected = await readFile(path.join(root, "dist/client/assets", asset), "utf8");
const state = path.join(root, "isolated-state");
async function start() {
  const child = spawn(process.execPath, ["scripts/local-server.mjs", "--port", "0", "--state", state], {
    cwd: root, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(root, "wrangler.log") },
  });
  const completion = once(child, "exit");
  let logs = "";
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM");
    }
    let timer;
    try { await Promise.race([completion, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("隔离服务未按时退出")), 10000); })]); }
    finally { clearTimeout(timer); }
  };
  try {
    const base = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`隔离服务启动超时：${logs.slice(-1500)}`)), 60000);
      function output(chunk) {
        logs += chunk;
        const match = logs.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      }
      child.stdout.on("data", output); child.stderr.on("data", output);
      child.once("exit", () => { clearTimeout(timer); reject(new Error(`隔离服务提前结束：${logs.slice(-1500)}`)); });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    assert.match(logs, new RegExp(release.id));
    return { base, stop };
  } catch (error) { await stop(); throw error; }
}
const fetchText = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200); return response.text();
};
let runtime = await start();
try {
  assert.equal(await fetchText(`${runtime.base}/assets/${asset}`), expected);
  assert.match(await fetchText(runtime.base), /创建首位管理员/);
  await writeFile(path.join(root, "dist/client/assets", asset), "REBUILT-ASSET-MUST-NOT-LEAK");
  await writeFile(path.join(root, "dist/server/index.js"), "throw new Error('half-built worker');");
  await writeFile(path.join(root, "scripts/local-runtime.mjs"), "throw new Error('unreleased runtime');");
  await writeFile(path.join(root, "scripts/local-migrations.mjs"), "this is not valid javascript");
  await writeFile(path.join(root, "drizzle", `${localMigrationNames[0]}.sql`), "NOT VALID SQL");
  assert.equal(await fetchText(`${runtime.base}/assets/${asset}`), expected);
  assert.match(await fetchText(runtime.base), /创建首位管理员/);
} finally { await runtime.stop(); }
runtime = await start();
try {
  assert.equal((await activeRelease(root)).id, release.id);
  assert.equal(await fetchText(`${runtime.base}/assets/${asset}`), expected);
  assert.match(await fetchText(runtime.base), /创建首位管理员/);
  console.log("固定版本实际运行通过：独立D1/R2路径、覆盖构建/运行器/迁移来源后页面和资源仍一致，重启仍使用固定版本。");
} finally { await runtime.stop(); }
