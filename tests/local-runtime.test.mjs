import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { assertLocalPortAvailable, initializeLocalRuntime } from "../scripts/local-runtime.mjs";

const listenerCounts = () => ["SIGINT", "SIGTERM", ...(process.platform === "win32" ? ["SIGBREAK"] : [])].map(s => process.listenerCount(s));

test("an occupied loopback port is rejected without closing the existing service", async () => {
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await assert.rejects(() => assertLocalPortAvailable(port), e => e.code === "EADDRINUSE" && /不要删除/.test(e.message));
    assert.ok(server.listening);
  } finally { await new Promise(resolve => server.close(resolve)); }
  await assertLocalPortAvailable(port);
  await assertLocalPortAvailable(0);
  await assert.rejects(() => assertLocalPortAvailable(-1), /端口无效/);
});

test("startup failures dispose once, remove listeners and never skip migration failures", async () => {
  for (const stage of ["ready", "proxy", "migration", "checksum"]) {
    const before = listenerCounts(); let disposed = 0, migrated = 0;
    const error = stage === "proxy" ? Object.assign(new Error("!isClientError(syncRes.status)"), { code: "ERR_ASSERTION" }) : new Error(`${stage} rejected`);
    const runtime = { get ready() { if (stage === "ready") throw error; return Promise.resolve("http://127.0.0.1:9999/"); },
      async dispose() { disposed++; } };
    await assert.rejects(() => initializeLocalRuntime(runtime, async () => { migrated++; throw error; }),
      e => stage === "proxy" ? e.cause === error && /未跳过迁移/.test(e.message) : e === error);
    await runtime.dispose();
    assert.equal(disposed, 1); assert.equal(migrated, stage === "ready" ? 0 : 1);
    assert.deepEqual(listenerCounts(), before);
  }
});

test("repeat signals and explicit disposal share cleanup without resetting a prior failure exit code", async () => {
  const before = listenerCounts(), previousExitCode = process.exitCode;
  let disposed = 0, finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const runtime = { ready: Promise.resolve("http://127.0.0.1:9999/"), async dispose() { disposed++; await gate; } };
  await initializeLocalRuntime(runtime, async () => {});
  try {
    process.exitCode = 7;
    process.emit("SIGINT"); process.emit("SIGTERM");
    const first = runtime.dispose(), second = runtime.dispose();
    assert.equal(first, second); finish(); await first;
    assert.equal(disposed, 1); assert.equal(process.exitCode, 7);
    assert.deepEqual(listenerCounts(), before);
  } finally { finish(); await runtime.dispose(); process.exitCode = previousExitCode; }
});

test("a signal during initialization cannot print readiness or return a disposed runtime", async () => {
  const before = listenerCounts(); let entered, finish, disposed = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const runtime = { ready: Promise.resolve("http://127.0.0.1:9999/"), async dispose() { disposed++; } };
  const result = initializeLocalRuntime(runtime, async () => { entered(); await gate; });
  const rejected = assert.rejects(result, /启动已取消/);
  await started; process.emit("SIGINT"); finish(); await rejected;
  assert.equal(disposed, 1); assert.deepEqual(listenerCounts(), before);
});
