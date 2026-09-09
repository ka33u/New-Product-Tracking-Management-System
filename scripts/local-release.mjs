import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat, copyFile, rename, unlink, rmdir, chmod } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const releaseIdPattern = /^\d{8}T\d{6}Z-[a-f0-9]{12}$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safePath = (name) => typeof name === "string" && name && !name.includes("\\") && !path.posix.isAbsolute(name)
  && name.split("/").every((part) => part && part !== "." && part !== "..") && !/[\x00-\x1f:]/.test(name);
async function realDirectory(directory) {
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`版本目录无效：${directory}`);
}
async function inventory(directory, prefix = "") {
  await realDirectory(directory);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!safePath(relative)) throw new Error("版本包含不安全路径。");
    const location = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("版本文件不能是符号链接。");
    if (entry.isDirectory()) files.push(...await inventory(location, relative));
    else if (entry.isFile()) { const bytes = await readFile(location); files.push({ path: relative, size: bytes.length, sha256: digest(bytes) }); }
    else throw new Error("版本包含非普通文件。");
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function runtimeIdentity(root) {
  return { nodeVersion: process.versions.node,
    miniflare: JSON.parse(await readFile(path.join(root, "node_modules/miniflare/package.json"), "utf8")).version,
    lockSha256: digest(await readFile(path.join(root, "package-lock.json"))) };
}
async function bindingsFor(root) {
  const config = JSON.parse(await readFile(path.join(root, "dist/server/wrangler.json"), "utf8"));
  const database = config.d1_databases?.find((item) => item.binding === "DB");
  const bucket = config.r2_buckets?.find((item) => item.binding === "FILES");
  if (config.vars?.NPD_AUTH_MODE !== "local" || !database?.database_id || !bucket?.bucket_name ||
    config.main !== "index.js" || config.assets?.directory !== "../client") throw new Error("版本不是预期的完整本地构建。");
  return { databaseId: database.database_id, bucketName: bucket.bucket_name, authMode: "local" };
}
async function releaseBase(root) {
  const base = path.join(root, ".local-releases");
  await mkdir(base, { recursive: true }); await realDirectory(base); return base;
}
export async function prepareRelease(root = defaultRoot) {
  const base = await releaseBase(root);
  const { localMigrationNames } = await import(pathToFileURL(path.join(root, "scripts/local-migrations.mjs")).href);
  if (!Array.isArray(localMigrationNames) || localMigrationNames.some((name) => !/^\d{4}_[a-z0-9_]+$/.test(name))) throw new Error("本地迁移清单无效。");
  const id = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "") + "-" + randomBytes(6).toString("hex");
  const directory = await mkdtemp(path.join(base, ".preparing-"));
  const sourcePaths = ["scripts/local-runtime.mjs", "scripts/local-migrations.mjs", "package.json", "package-lock.json",
    ...localMigrationNames.map((name) => `drizzle/${name}.sql`)];
  const files = (await inventory(path.join(root, "dist"), "dist"));
  for (const relative of sourcePaths) {
    const source = path.join(root, relative);
    const entry = await lstat(source);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`版本来源无效：${relative}`);
    const bytes = await readFile(source); files.push({ path: relative, size: bytes.length, sha256: digest(bytes) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const target = path.join(directory, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file.path), target);
    if (digest(await readFile(target)) !== file.sha256 || digest(await readFile(path.join(root, file.path))) !== file.sha256) {
      throw new Error("复制期间构建发生变化，候选版本未启用，请完成构建后重试。");
    }
  }
  const finalBuildFiles = await inventory(path.join(root, "dist"), "dist");
  if (JSON.stringify(finalBuildFiles) !== JSON.stringify(files.filter((file) => file.path.startsWith("dist/")))) throw new Error("复制期间构建清单发生变化，候选版本未启用。");
  for (const file of files.filter((item) => !item.path.startsWith("dist/"))) {
    if (digest(await readFile(path.join(root, file.path))) !== file.sha256) throw new Error("复制期间启动器、迁移或依赖清单发生变化，候选版本未启用。");
  }
  const bindings = await bindingsFor(directory);
  const runtime = await runtimeIdentity(root);
  if (runtime.lockSha256 !== files.find((file) => file.path === "package-lock.json").sha256) throw new Error("准备期间依赖清单变化，候选版本未启用。");
  for (const required of ["dist/server/index.js", "dist/client", "scripts/local-runtime.mjs"]) await lstat(path.join(directory, required));
  const manifest = { format: 1, id, createdAt: new Date().toISOString(), runtime, bindings, migrations: localMigrationNames, files };
  await writeFile(path.join(directory, "release.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
  const directories = new Set([directory]);
  for (const file of [...files.map((item) => item.path), "release.json"]) {
    const location = path.join(directory, file); await chmod(location, 0o444);
    for (let parent = path.dirname(location); parent !== directory; parent = path.dirname(parent)) directories.add(parent);
  }
  for (const location of [...directories].sort((a, b) => b.length - a.length)) await chmod(location, 0o555);
  await rename(directory, path.join(base, id));
  await verifyRelease(id, root);
  return { id, directory: path.join(base, id), active: false };
}
export async function verifyRelease(id, root = defaultRoot, checkRuntime = true) {
  if (!releaseIdPattern.test(id || "")) throw new Error("本地版本标识无效。");
  const base = path.join(root, ".local-releases"); await realDirectory(base);
  const directory = path.join(base, id); await realDirectory(directory);
  const manifestPath = path.join(directory, "release.json");
  const stat = await lstat(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("版本清单必须是普通文件。");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.format !== 1 || manifest.id !== id || !Array.isArray(manifest.files) || !manifest.files.length ||
    !Array.isArray(manifest.migrations) || manifest.migrations.some((name) => !/^\d{4}_[a-z0-9_]+$/.test(name))) throw new Error("版本清单无效。");
  if (manifest.files.some((file) => !safePath(file.path))) throw new Error("版本清单路径无效。");
  const actual = (await inventory(directory)).filter((file) => file.path !== "release.json");
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error("本地版本文件缺失、被修改或混入其他文件，拒绝启动。");
  if (checkRuntime && JSON.stringify(manifest.runtime) !== JSON.stringify(await runtimeIdentity(root))) throw new Error("运行依赖或Node版本已变化，请重新构建验收并准备新版本，不能混用旧版本。");
  if (JSON.stringify(manifest.bindings) !== JSON.stringify(await bindingsFor(directory))) throw new Error("版本数据库/附件绑定不一致。");
  return { directory, manifest };
}
export async function activeRelease(root = defaultRoot, checkRuntime = true) {
  const pointer = path.join(root, ".local-releases/active.json");
  let stat;
  try { stat = await lstat(pointer); } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try { await lstat(path.join(root, ".local-releases/PINNED")); }
    catch (markerError) { if (markerError.code === "ENOENT") return null; throw markerError; }
    throw new Error("已启用固定版本但当前版本指针丢失，拒绝回退到未验收的dist。");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("当前版本指针无效。");
  const { id } = JSON.parse(await readFile(pointer, "utf8"));
  return { id, ...await verifyRelease(id, root, checkRuntime) };
}
export async function activateRelease(id, root = defaultRoot) {
  const candidate = await verifyRelease(id, root);
  const base = await releaseBase(root);
  const lock = path.join(base, ".activation-lock");
  try { await mkdir(lock); } catch (error) { if (error.code === "EEXIST") throw new Error("另一次版本切换尚未结束，请勿同时切换。"); throw error; }
  try {
  // Validate old contents/migrations even when dependencies have intentionally
  // changed; only the NEW candidate must match the currently installed runtime.
  const previous = await activeRelease(root, false);
  if (previous) {
    if (JSON.stringify(previous.manifest.bindings) !== JSON.stringify(candidate.manifest.bindings)) throw new Error("新版本改变数据库或附件绑定，拒绝切换以免误用空库。");
    for (const name of previous.manifest.migrations) {
      const migrationPath = `drizzle/${name}.sql`;
      const old = previous.manifest.files.find((file) => file.path === migrationPath);
      const next = candidate.manifest.files.find((file) => file.path === migrationPath);
      if (!candidate.manifest.migrations.includes(name) || !old || old.sha256 !== next?.sha256) throw new Error("候选版本缺少已有迁移或改写旧迁移，不能直接降级/切换。");
    }
  }
  const marker = path.join(base, "PINNED");
  try { await writeFile(marker, "固定版本已启用；指针缺失时不得回退dist。\n", { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const markerStat = await lstat(marker);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error("固定版本标记无效。");
  const temp = path.join(base, `.active-${randomBytes(8).toString("hex")}.json`);
  await writeFile(temp, JSON.stringify({ id, previousId: previous?.id || null, activatedAt: new Date().toISOString() }), { flag: "wx" });
  try { await rename(temp, path.join(base, "active.json")); }
  catch (error) { await unlink(temp); throw error; }
  return { id, previousId: previous?.id || null, restartRequired: true };
  } finally { await rmdir(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, id, ...extra] = process.argv.slice(2);
  if (extra.length || !["prepare", "verify", "activate", "status"].includes(command)) throw new Error("使用 prepare、verify <版本>、activate <版本> 或 status。");
  const result = command === "prepare" ? await prepareRelease() : command === "verify" ? await verifyRelease(id)
    : command === "activate" ? await activateRelease(id) : await activeRelease();
  console.log(JSON.stringify(result?.manifest ? { id: result.manifest.id, directory: result.directory,
    createdAt: result.manifest.createdAt, files: result.manifest.files.length, runtime: result.manifest.runtime, bindings: result.manifest.bindings } : result, null, 2));
}
