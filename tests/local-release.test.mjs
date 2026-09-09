import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, unlink, symlink, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareRelease, verifyRelease, activateRelease, activeRelease } from "../scripts/local-release.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "hengda-release-unit-"));
  const files = {
    "dist/server/index.js": "export default {fetch(){return new Response('fixture')}}",
    "dist/client/asset.js": "original-client",
    "dist/server/wrangler.json": JSON.stringify({ vars: { NPD_AUTH_MODE: "local" }, main: "index.js", assets: { directory: "../client" },
      d1_databases: [{ binding: "DB", database_id: "same-database" }], r2_buckets: [{ binding: "FILES", bucket_name: "same-files" }] }),
    "scripts/local-runtime.mjs": "export const startLocalRuntime=()=>{};",
    "scripts/local-migrations.mjs": "export const localMigrationNames=['0001_fixture'];",
    "drizzle/0001_fixture.sql": "SELECT 1;", "package.json": '{"type":"module"}', "package-lock.json": "{}",
    "node_modules/miniflare/package.json": '{"version":"fixture"}',
  };
  for (const [name, content] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), content); }
  return root;
}
test("固定版本隔离构建覆盖，依赖改变拒绝旧版但允许经检查的新版本", async () => {
  const root = await fixture();
  assert.equal(await activeRelease(root), null);
  const first = await prepareRelease(root);
  assert.equal((await stat(path.join(first.directory, "dist/client/asset.js"))).mode & 0o222, 0);
  assert.equal(await activeRelease(root), null, "准备不等于启用");
  await activateRelease(first.id, root);
  await writeFile(path.join(root, "dist/client/asset.js"), "rebuilt-client");
  assert.equal(await readFile(path.join(first.directory, "dist/client/asset.js"), "utf8"), "original-client");
  assert.equal((await activeRelease(root)).id, first.id);
  await writeFile(path.join(root, "package-lock.json"), '{"new":"dependency"}');
  await assert.rejects(() => activeRelease(root), /依赖或Node版本/);
  const second = await prepareRelease(root);
  await activateRelease(second.id, root);
  assert.equal((await activeRelease(root)).id, second.id);
  assert.equal((await verifyRelease(first.id, root, false)).manifest.id, first.id);
});
test("文件损坏、符号链接、丢失指针和路径越界均拒绝，不回退到dist", async () => {
  const root = await fixture();
  const release = await prepareRelease(root); await activateRelease(release.id, root);
  await assert.rejects(() => verifyRelease("../../private", root), /标识无效/);
  const file = path.join(release.directory, "dist/client/asset.js");
  // A machine owner can override read-only mode; integrity checks still fail.
  await chmod(path.dirname(file), 0o755); await chmod(file, 0o644);
  await writeFile(file, "tampered");
  await assert.rejects(() => activeRelease(root), /文件缺失、被修改/);
  await unlink(file); await symlink(path.join(root, "dist/client/asset.js"), file);
  await assert.rejects(() => verifyRelease(release.id, root), /符号链接/);
  await unlink(file); await writeFile(file, "original-client");
  await unlink(path.join(root, ".local-releases/active.json"));
  await assert.rejects(() => activeRelease(root), /指针丢失/);
});
test("绑定变更、旧迁移改写及并发切换不覆盖现有版本", async () => {
  const root = await fixture();
  const first = await prepareRelease(root); await activateRelease(first.id, root);
  const configFile = path.join(root, "dist/server/wrangler.json");
  const config = JSON.parse(await readFile(configFile, "utf8"));
  config.d1_databases[0].database_id = "different";
  await writeFile(configFile, JSON.stringify(config));
  const wrongBinding = await prepareRelease(root);
  await assert.rejects(() => activateRelease(wrongBinding.id, root), /改变数据库/);
  assert.equal((await activeRelease(root)).id, first.id);
  config.d1_databases[0].database_id = "same-database";
  await writeFile(configFile, JSON.stringify(config));
  await writeFile(path.join(root, "drizzle/0001_fixture.sql"), "SELECT 2;");
  const wrongMigration = await prepareRelease(root);
  await assert.rejects(() => activateRelease(wrongMigration.id, root), /旧迁移/);
  assert.equal((await activeRelease(root)).id, first.id);
  await writeFile(path.join(root, "drizzle/0001_fixture.sql"), "SELECT 1;");
  const second = await prepareRelease(root);
  const result = await Promise.allSettled([1, 2].map(() => activateRelease(second.id, root)));
  assert.equal(result.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal((await activeRelease(root)).id, second.id);
});
