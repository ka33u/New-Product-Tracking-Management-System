import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Legacy 0000–0004 tables already have a local runtime bootstrap. Do not replay
// or mark those historical migrations applied. All NEW local schema is owned
// by the generated migrations below, never by request-time CREATE/ALTER logic.
export const localMigrationNames = ["0005_new_quasimodo", "0006_slimy_gamma_corps", "0007_abandoned_mandarin", "0008_fuzzy_gressill", "0009_brave_cloak", "0010_plain_lake"];
export async function applyLocalMigrations(database) {
  await database.prepare(`CREATE TABLE IF NOT EXISTS __npd_local_migrations (
    name TEXT PRIMARY KEY, checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  for (const name of localMigrationNames) {
    const sql = await readFile(new URL(`../drizzle/${name}.sql`, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = await database.prepare("SELECT checksum FROM __npd_local_migrations WHERE name=?").bind(name).first();
    if (existing) {
      if (existing.checksum !== checksum) throw new Error(`已执行的本地迁移 ${name} 被修改，拒绝启动。请恢复原迁移文件。`);
      continue;
    }
    const statements = sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
    await database.batch([
      ...statements.map((statement) => database.prepare(statement)),
      database.prepare("INSERT INTO __npd_local_migrations(name,checksum) VALUES (?,?)").bind(name, checksum),
    ]);
  }
}

// Development-only preparation. The everyday server calls the same helper
// against its own DB binding before reporting readiness.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { Miniflare } = await import("miniflare");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = JSON.parse(await readFile(path.join(root, "dist/server/wrangler.json"), "utf8"));
  if (config.vars?.NPD_AUTH_MODE !== "local") throw new Error("仅支持已构建的本地版本，请先 npm run build。");
  const database = config.d1_databases.find((item) => item.binding === "DB");
  const runtime = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('migration')}}",
    port: 0, host: "127.0.0.1", d1Databases: { DB: database.database_id }, d1Persist: path.join(root, ".wrangler/state/v3/d1") });
  try { await applyLocalMigrations(await runtime.getD1Database("DB")); console.log("本地增量迁移已就绪。"); }
  finally { await runtime.dispose(); }
}
