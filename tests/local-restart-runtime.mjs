import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Miniflare } from "miniflare";
import { startLocalRuntime, assertLocalPortAvailable } from "../scripts/local-runtime.mjs";
import { localMigrationNames } from "../scripts/local-migrations.mjs";

// Always a newly owned directory: never accepts an existing business state path.
const buildRoot = fileURLToPath(new URL("../", import.meta.url));
const state = await mkdtemp(path.join(tmpdir(), "hengda-restart-issues-"));
const listeners = () => ["SIGINT", "SIGTERM", ...(process.platform === "win32" ? ["SIGBREAK"] : [])].map(s => process.listenerCount(s));
const before = listeners();
let port = 0, baseline;
for (let cycle = 0; cycle < 3; cycle++) {
  const runtime = await startLocalRuntime({ buildRoot, state, port });
  try {
    const url = await runtime.ready;
    port = Number(url.port);
    const db = await runtime.getD1Database("DB"), bucket = await runtime.getR2Bucket("FILES");
    const migrations = (await db.prepare("SELECT name,checksum,applied_at FROM __npd_local_migrations ORDER BY name").all()).results;
    assert.deepEqual(migrations.map(m => m.name), localMigrationNames);
    if (cycle === 0) {
      baseline = migrations;
      await db.prepare("CREATE TABLE restart_marker(id TEXT PRIMARY KEY,value TEXT NOT NULL)").run();
      await db.prepare("INSERT INTO restart_marker VALUES (?,?)").bind("isolated", "重启保留<&>✅").run();
      await bucket.put("restart-fixture.txt", "隔离附件原件");
    } else assert.deepEqual(migrations, baseline, "迁移不能重放或丢失校验值");
    assert.equal((await db.prepare("SELECT value FROM restart_marker WHERE id=?").bind("isolated").first()).value, "重启保留<&>✅");
    assert.equal(await (await bucket.get("restart-fixture.txt")).text(), "隔离附件原件");
    assert.equal((await fetch(url, { signal: AbortSignal.timeout(15000) })).status, 200);
    const runningListeners = listeners();
    await assert.rejects(() => startLocalRuntime({ buildRoot, state, port }), e => e.code === "EADDRINUSE");
    assert.deepEqual(listeners(), runningListeners, "拒绝重复启动不得留下监听器");
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM restart_marker").first()).n, 1);
    if (cycle === 2) await db.prepare("UPDATE __npd_local_migrations SET checksum='deliberately-corrupt-test' WHERE name=?").bind(localMigrationNames[0]).run();
  } finally { await runtime.dispose(); }
  assert.deepEqual(listeners(), before);
  await assertLocalPortAvailable(port);
}

await assert.rejects(() => startLocalRuntime({ buildRoot, state, port }), /已执行的本地迁移.*被修改/);
assert.deepEqual(listeners(), before);
await assertLocalPortAvailable(port);
// Check failed startup didn't remove either persistent store.
const config = JSON.parse(await readFile(path.join(buildRoot, "dist/server/wrangler.json"), "utf8"));
const probe = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('isolated probe')}}", port: 0, host: "127.0.0.1",
  d1Databases: { DB: config.d1_databases.find(d => d.binding === "DB").database_id }, d1Persist: path.join(state, "v3/d1"),
  r2Buckets: { FILES: config.r2_buckets.find(b => b.binding === "FILES").bucket_name }, r2Persist: path.join(state, "v3/r2") });
try {
  const db = await probe.getD1Database("DB");
  assert.equal((await db.prepare("SELECT value FROM restart_marker WHERE id='isolated'").first()).value, "重启保留<&>✅");
  assert.equal(await (await (await probe.getR2Bucket("FILES")).get("restart-fixture.txt")).text(), "隔离附件原件");
} finally { await probe.dispose(); }

// Exercise the actual launcher as a separate process. On POSIX send a real
// SIGINT; on Windows use the same graceful stop path through parent-owned IPC
// because child.kill("SIGINT") force-terminates Windows processes.
const cliState = await mkdtemp(path.join(tmpdir(), "hengda-cli-restart-"));
let cliPort = 0;
async function launch() {
  const child = spawn(process.execPath, ["scripts/local-server.mjs", "--build", "--state", cliState, "--port", String(cliPort)], {
    cwd: buildRoot, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(cliState, "wrangler.log") },
  });
  const exited = once(child, "exit");
  let logs = "";
  const completion = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`启动器未完成清理：${logs.slice(-1500)}`)), 15000);
    exited.then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const stop = async signal => {
    if (child.exitCode === null && child.signalCode === null) {
      if (signal && process.platform !== "win32") child.kill("SIGINT");
      else child.send("npd:shutdown");
    }
    const [code, endedBySignal] = await completion();
    assert.equal(code, 0, logs); assert.equal(endedBySignal, null, logs);
  };
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`启动器超时：${logs.slice(-1500)}`)), 30000);
      const output = chunk => {
        logs += chunk;
        const found = logs.match(/Ready on (http:\/\/127\.0\.0\.1:\d+\/?)/);
        if (found) { clearTimeout(timer); resolve(new URL(found[1])); }
      };
      child.stdout.on("data", output); child.stderr.on("data", output);
      exited.then(() => { clearTimeout(timer); reject(new Error(`启动器提前退出：${logs.slice(-1500)}`)); }, reject);
    });
    return { url, stop };
  } catch (error) { await stop(false); throw error; }
}
for (let cycle = 0; cycle < 2; cycle++) {
  const cli = await launch();
  try {
    cliPort = Number(cli.url.port);
    assert.equal((await fetch(cli.url, { signal: AbortSignal.timeout(15000) })).status, 200);
  } finally { await cli.stop(cycle === 0); }
  await assertLocalPortAvailable(cliPort);
}
// The real worker-thread launcher must propagate a migration failure, close
// the worker and listener, and never advertise readiness on that failed start.
const failed = spawn(process.execPath, ["scripts/local-server.mjs", "--build", "--state", state, "--port", String(port)], {
  cwd: buildRoot, stdio: ["ignore", "pipe", "pipe", "ipc"],
  env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(state, "failure-wrangler.log") },
});
let failureLog = "";
failed.stdout.on("data", chunk => { failureLog += chunk; });
failed.stderr.on("data", chunk => { failureLog += chunk; });
let failureTimer;
try {
  const result = await Promise.race([once(failed, "exit"), new Promise((_, reject) => {
    failureTimer = setTimeout(() => { if (failed.connected) failed.send("npd:shutdown"); reject(new Error("失败启动器未按时退出")); }, 15000);
  })]);
  assert.equal(result[0], 1, failureLog);
  assert.match(failureLog, /已执行的本地迁移.*被修改/);
  assert.doesNotMatch(failureLog, /Ready on/);
} finally { clearTimeout(failureTimer); }
await assertLocalPortAvailable(port);
console.log(`重启专项通过 (${process.platform}, Node ${process.versions.node})：同端口三次启动、D1/R2保留、迁移不重放、重复启动拒绝、退出清理、校验失败停止且数据保留。未模拟强杀或断电。`);
