import { createReadStream, constants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as sqlite from "node:sqlite";

const exec = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const format = "hengda-local-backup-v1";

async function canonicalCandidate(value) {
  const absolute = path.resolve(value);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return path.join(await canonicalCandidate(path.dirname(absolute)), path.basename(absolute));
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function safeRelative(value) {
  if (typeof value !== "string" || value.includes("\\") || value.includes("\0") ||
      path.isAbsolute(value) || value.split("/").some((part) => !part || part === "." || part === "..") ||
      !/^(d1|r2)\//.test(value)) throw new Error("备份中存在不安全的文件路径。");
  return value;
}

async function filesIn(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error("备份和恢复目录不允许包含符号链接。");
    if (entry.isDirectory()) result.push(...await filesIn(root, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error("备份目录中包含非普通文件。");
  }
  return result;
}

async function checksum(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(root) {
  const result = [];
  for (const relative of await filesIn(root)) {
    const stat = await lstat(path.join(root, relative));
    result.push({ path: relative, size: stat.size, sha256: await checksum(path.join(root, relative)) });
  }
  return result;
}

async function sourceInventory(root) {
  // SQLite may create/refresh shared-memory bookkeeping on a read-only open.
  // These bytes are not durable data; nonempty WAL files must still be checked.
  return (await inventory(root)).filter((file) =>
    /^(d1|r2)\//.test(file.path) && !file.path.endsWith(".sqlite-shm") &&
    !(file.path.endsWith(".sqlite-wal") && file.size === 0));
}

async function assertOffline(root) {
  const databases = (await filesIn(root)).filter((file) => /^(d1|r2)\//.test(file) && file.endsWith(".sqlite"));
  if (!databases.length) throw new Error("没有发现本地数据库，拒绝生成空备份。");
  // Fail closed when macOS open-handle inspection is unavailable.
  for (let offset = 0; offset < databases.length; offset += 50) {
    try {
      const { stdout, stderr } = await exec("lsof", ["-t", "--", ...databases.slice(offset, offset + 50).map((file) => path.join(root, file))]);
      if (stdout.trim()) throw Object.assign(new Error("数据库正在使用。请先停止本地服务，再执行备份；不要只关闭浏览器。"), { code: "DATABASE_BUSY" });
      if (stderr.trim()) throw new Error("无法确认数据库已停用，备份已停止。");
    } catch (error) {
      if (error.code === 1 && !error.stdout?.trim() && !error.stderr?.trim()) continue;
      throw error;
    }
  }
}

function inspectDatabases(root, files) {
  let applicationDb = null;
  const counts = {};
  for (const file of files.filter((item) => item.endsWith(".sqlite"))) {
    const database = new sqlite.DatabaseSync(path.join(root, file), { readOnly: true });
    try {
      const integrity = database.prepare("PRAGMA integrity_check").all();
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw new Error(`数据库完整性校验失败：${file}`);
      if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error(`数据库存在引用错误：${file}`);
      const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name);
      if (tables.includes("npd_projects")) {
        if (applicationDb) throw new Error("发现多个新品开发数据库，需先确认正确的数据目录。");
        applicationDb = file;
        for (const required of ["npd_users", "npd_documents", "npd_project_sheets"]) {
          if (!tables.includes(required)) throw new Error(`新品开发数据库缺少关键表：${required}`);
        }
        for (const table of tables.filter((name) => /^npd_[a-z_]+$/.test(name))) {
          counts[table] = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count;
        }
      }
    } finally { database.close(); }
  }
  if (!applicationDb) throw new Error("未发现完整的新品开发数据库。");
  return { applicationDb, counts };
}

export async function createBackup({ stateRoot = path.join(projectRoot, ".wrangler/state/v3"), backupRoot = path.join(projectRoot, "backups") } = {}) {
  if (typeof sqlite.backup !== "function") throw new Error("备份功能需要 Node.js 22.16 或更新版本。");
  stateRoot = await realpath(stateRoot);
  backupRoot = await canonicalCandidate(backupRoot);
  if (inside(stateRoot, backupRoot) || inside(backupRoot, stateRoot)) throw new Error("备份目录必须独立于运行数据目录。");
  await assertOffline(stateRoot);
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  backupRoot = await realpath(backupRoot);
  if (inside(stateRoot, backupRoot) || inside(backupRoot, stateRoot)) throw new Error("备份目录不能链接到运行数据目录。");
  const before = await sourceInventory(stateRoot);
  const selected = before.filter((file) => /^(d1|r2)\//.test(file.path) && !/\.sqlite-(wal|shm)$/.test(file.path));
  const staging = await mkdtemp(path.join(backupRoot, ".incomplete-"));
  const state = path.join(staging, "state");
  await mkdir(state, { mode: 0o700 });
  for (const file of selected) {
    const source = path.join(stateRoot, file.path);
    const destination = path.join(state, file.path);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (file.path.endsWith(".sqlite")) {
      const database = new sqlite.DatabaseSync(source, { readOnly: true });
      try { await sqlite.backup(database, destination); } finally { database.close(); }
      const standalone = new sqlite.DatabaseSync(destination);
      try { standalone.exec("PRAGMA journal_mode=DELETE"); } finally { standalone.close(); }
    } else await copyFile(source, destination, constants.COPYFILE_EXCL);
    await chmod(destination, 0o600);
  }
  await assertOffline(stateRoot);
  if (JSON.stringify(before) !== JSON.stringify(await sourceInventory(stateRoot))) {
    throw new Error(`备份期间源数据发生变化，未生成有效备份。未完成副本保留在 ${staging}`);
  }
  const summary = inspectDatabases(state, selected.map((file) => file.path));
  const manifest = { format, createdAt: new Date().toISOString(), nodeVersion: process.version,
    scope: "本地 D1 数据库及 R2 附件；不含程序源码或外部服务", ...summary,
    files: await inventory(state) };
  await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await verifyBackup(staging);
  const destination = path.join(backupRoot, `hengda-${manifest.createdAt.replace(/[:.]/g, "-")}-${path.basename(staging).slice(-6)}`);
  await rename(staging, destination);
  return { directory: destination, ...summary, files: manifest.files.length };
}

export async function verifyBackup(directory) {
  directory = await realpath(directory);
  const packageFiles = await filesIn(directory);
  if (packageFiles.some((file) => file !== "manifest.json" && !file.startsWith("state/"))) throw new Error("备份包包含未声明文件。");
  const manifestStat = await lstat(path.join(directory, "manifest.json"));
  if (manifestStat.size > 8 * 1024 * 1024) throw new Error("备份清单过大。");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== format || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error("备份清单格式无效。");
  const names = new Set();
  const state = path.join(directory, "state");
  for (const file of manifest.files) {
    safeRelative(file.path);
    if (names.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("备份清单存在重复或无效条目。");
    names.add(file.path);
    const filename = path.join(state, file.path);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.size !== file.size || await checksum(filename) !== file.sha256) throw new Error(`文件校验失败：${file.path}`);
  }
  const actual = await filesIn(state);
  if (actual.length !== names.size || actual.some((file) => !names.has(file))) throw new Error("备份文件与清单不一致。");
  const summary = inspectDatabases(state, actual);
  if (summary.applicationDb !== manifest.applicationDb || JSON.stringify(summary.counts) !== JSON.stringify(manifest.counts)) throw new Error("数据库记录数量与备份清单不一致。");
  return { manifest, ...summary };
}

export async function restoreBackup({ directory, destination }) {
  const { manifest, applicationDb } = await verifyBackup(directory);
  directory = await realpath(directory);
  destination = await canonicalCandidate(destination);
  if (inside(directory, destination) || inside(destination, directory)) throw new Error("恢复目录必须独立于备份包。");
  // Never overwrite a live or existing directory. Existing data stays intact.
  await mkdir(destination, { mode: 0o700 });
  const root = await realpath(destination);
  if (inside(directory, root) || inside(root, directory)) throw new Error("恢复目录不能链接到备份包。");
  for (const file of manifest.files) {
    const output = path.join(root, safeRelative(file.path));
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await copyFile(path.join(directory, "state", file.path), output, constants.COPYFILE_EXCL);
    await chmod(output, 0o600);
    if (await checksum(output) !== file.sha256) throw new Error("恢复后文件校验失败，请勿启用此目录。");
  }
  // A restored backup must never resurrect a previous login session.
  const database = new sqlite.DatabaseSync(path.join(root, applicationDb));
  let revokedSessions = 0;
  try {
    if (database.prepare("SELECT name FROM sqlite_schema WHERE name='npd_local_sessions'").get()) {
      revokedSessions = Number(database.prepare("DELETE FROM npd_local_sessions").run().changes);
    }
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { database.close(); }
  const { counts } = inspectDatabases(root, manifest.files.map((file) => file.path));
  return { directory: root, counts, revokedSessions };
}

async function createManagedBackup(backupRoot) {
  if (process.platform !== "darwin" || !process.getuid) throw new Error("托管服务备份仅适用于本机 macOS 部署。");
  const label = "com.hengda.npd.local";
  const plist = path.join(homedir(), "Library/LaunchAgents", `${label}.plist`);
  const { stdout } = await exec("plutil", ["-convert", "json", "-o", "-", plist]);
  const configuration = JSON.parse(stdout);
  const args = configuration.ProgramArguments;
  const compiledLocalService = Array.isArray(args) && args.length === 3 &&
    args[0] === "/opt/homebrew/bin/npm" && args[1] === "run" && args[2] === "start:local";
  if (configuration.Label !== label || !configuration.WorkingDirectory ||
      await realpath(configuration.WorkingDirectory) !== await realpath(projectRoot) ||
      !Array.isArray(args) || (!compiledLocalService && !args.includes("3011"))) {
    throw new Error("托管服务不属于当前项目，拒绝停止。请使用普通离线备份方式。");
  }
  const domain = `gui/${process.getuid()}`;
  await exec("launchctl", ["print", `${domain}/${label}`]);
  console.log("暂停本项目托管服务，开始离线备份……");
  await exec("launchctl", ["bootout", `${domain}/${label}`]);
  try {
    // launchctl can return while workerd is still releasing its SQLite handles.
    // Wait briefly for those exact files, never kill unrelated processes.
    for (let attempt = 0; ; attempt++) {
      try { await assertOffline(path.join(projectRoot, ".wrangler/state/v3")); break; }
      catch (error) {
        if (error.code !== "DATABASE_BUSY" || attempt >= 20) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return await createBackup(backupRoot ? { backupRoot } : {});
  } finally {
    try {
      await exec("launchctl", ["bootstrap", domain, plist]);
      console.log("本项目托管服务已重新启动，请检查 http://localhost:3011/。");
    } catch (error) {
      throw new Error(`托管服务重启失败，请管理员重新加载 ${plist}。原因：${error.message}`);
    }
  }
}

async function main(args) {
  const [command, first, second] = args;
  if (command === "create" && !second) console.log(JSON.stringify(await createBackup(first ? { backupRoot: first } : {}), null, 2));
  else if (command === "create-managed" && !second) console.log(JSON.stringify(await createManagedBackup(first), null, 2));
  else if (command === "verify" && first && !second) {
    const { counts } = await verifyBackup(first);
    console.log(JSON.stringify({ valid: true, counts }, null, 2));
  } else if (command === "restore" && first && second && args.length === 3) console.log(JSON.stringify(await restoreBackup({ directory: first, destination: second }), null, 2));
  else throw new Error("用法：npm run backup:local [-- 备份父目录]；npm run backup:verify -- 备份目录；npm run backup:restore -- 备份目录 不存在的新数据目录");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
