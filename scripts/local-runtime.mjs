import { readFile } from "node:fs/promises";
import path from "node:path";
import { Miniflare } from "miniflare";
import { applyLocalMigrations } from "./local-migrations.mjs";

export async function startLocalRuntime({ buildRoot, state, port }) {
  const serverRoot = path.join(buildRoot, "dist/server");
  const config = JSON.parse(await readFile(path.join(serverRoot, "wrangler.json"), "utf8"));
  const database = config.d1_databases?.find((item) => item.binding === "DB");
  const bucket = config.r2_buckets?.find((item) => item.binding === "FILES");
  if (config.vars?.NPD_AUTH_MODE !== "local" || !database?.database_id || !bucket?.bucket_name) throw new Error("构建不是完整的本地账户版本，不会创建替代数据库。");
  const runtime = new Miniflare({
    modules: true, scriptPath: path.join(serverRoot, config.main), modulesRoot: serverRoot,
    modulesRules: config.rules.map((rule) => ({ type: rule.type, include: rule.globs })),
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
    bindings: config.vars, host: "127.0.0.1", port,
    d1Databases: { DB: database.database_id }, d1Persist: path.join(state, "v3/d1"),
    r2Buckets: { FILES: bucket.bucket_name }, r2Persist: path.join(state, "v3/r2"),
    assets: { directory: path.resolve(serverRoot, config.assets.directory), binding: "ASSETS", routerConfig: { has_user_worker: true } },
  });
  let stopping = false;
  async function stop() {
    if (stopping) return; stopping = true;
    try { await runtime.dispose(); process.exitCode = 0; }
    catch (error) { console.error("本地服务停止失败：", error); process.exitCode = 1; }
  }
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try { await applyLocalMigrations(await runtime.getD1Database("DB")); console.log(`Ready on ${await runtime.ready}`); }
  catch (error) { await runtime.dispose(); throw error; }
  return runtime;
}
