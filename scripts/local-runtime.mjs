import { readFile } from "node:fs/promises";
import path from "node:path";
import { createConnection } from "node:net";
import { Miniflare } from "miniflare";
import { applyLocalMigrations } from "./local-migrations.mjs";

// On Windows a surviving workerd can accept the new instance's proxy request
// and reject its secret with 4xx, surfaced by Miniflare as ERR_ASSERTION.
// Check the requested loopback listener without touching another process or DB.
export async function assertLocalPortAvailable(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("本地端口无效。");
  if (port === 0) return; // The OS selects an ephemeral port for isolated tests.
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; socket.destroy();
      if (error) reject(error); else resolve();
    };
    socket.once("connect", () => finish(Object.assign(new Error(
      `端口 127.0.0.1:${port} 已被占用。请先停止原服务及其残留子进程，再重新启动；不要删除 .wrangler 数据目录或跳过迁移。`,
    ), { code: "EADDRINUSE" })));
    socket.once("error", (error) => finish(error.code === "ECONNREFUSED" ? null
      : new Error(`无法确认本地端口 ${port} 是否空闲，已停止启动。`, { cause: error })));
    socket.setTimeout(1500, () => finish(new Error(`检查本地端口 ${port} 超时，已停止启动。`)));
  });
}

// One shared disposal promise prevents overlapping signal/error cleanup. Remove
// our listeners even after a failed start or explicit disposal by a test/tool.
export async function initializeLocalRuntime(runtime, migrate, { announceReady = true } = {}) {
  const dispose = runtime.dispose.bind(runtime);
  const signals = process.platform === "win32" ? ["SIGTERM", "SIGINT", "SIGBREAK"] : ["SIGTERM", "SIGINT"];
  let stopping;
  runtime.dispose = () => stopping ??= Promise.resolve().then(dispose).finally(() => {
    for (const signal of signals) process.removeListener(signal, stop);
  });
  function stop() {
    void runtime.dispose().catch((error) => { console.error("本地服务停止失败：", error); process.exitCode = 1; });
  }
  for (const signal of signals) process.on(signal, stop);
  try {
    const url = await runtime.ready;
    if (stopping) throw new Error("本地服务启动已取消。");
    await migrate(runtime);
    if (stopping) throw new Error("本地服务启动已取消。");
    if (announceReady) console.log(`Ready on ${url}`);
    return runtime;
  } catch (error) {
    try { await runtime.dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "本地服务启动和清理失败，请核对残留进程后重试；不要删除业务数据。", { cause: error }); }
    if (error.code === "ERR_ASSERTION" && /isClientError/.test(error.message)) {
      throw new Error("本地数据库代理连接失败，未跳过迁移校验。请检查旧服务/workerd 是否仍占用端口，并在完整停止后重试。", { cause: error });
    }
    throw error;
  }
}

export async function startLocalRuntime({ buildRoot, state, port, announceReady = true }) {
  const serverRoot = path.join(buildRoot, "dist/server");
  const config = JSON.parse(await readFile(path.join(serverRoot, "wrangler.json"), "utf8"));
  const database = config.d1_databases?.find((item) => item.binding === "DB");
  const bucket = config.r2_buckets?.find((item) => item.binding === "FILES");
  if (config.vars?.NPD_AUTH_MODE !== "local" || !database?.database_id || !bucket?.bucket_name) throw new Error("构建不是完整的本地账户版本，不会创建替代数据库。");
  await assertLocalPortAvailable(port);
  const runtime = new Miniflare({
    modules: true, scriptPath: path.join(serverRoot, config.main), modulesRoot: serverRoot,
    modulesRules: config.rules.map((rule) => ({ type: rule.type, include: rule.globs })),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: config.vars, host: "127.0.0.1", port,
    d1Databases: { DB: database.database_id }, d1Persist: path.join(state, "v3/d1"),
    r2Buckets: { FILES: bucket.bucket_name }, r2Persist: path.join(state, "v3/r2"),
    assets: { directory: path.resolve(serverRoot, config.assets.directory), binding: "ASSETS", routerConfig: { has_user_worker: true } },
  });
  return initializeLocalRuntime(runtime, async (instance) => {
    await applyLocalMigrations(await instance.getD1Database("DB"));
  }, { announceReady });
}
