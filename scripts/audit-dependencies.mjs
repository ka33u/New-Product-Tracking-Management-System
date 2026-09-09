import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { lstat, readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// npm's dependency graph cannot see code copied inside a published package.
// Targeted check for the layout observed in vinext 1.0.0-beta.9; this is not a
// general bundled-code/SBOM scanner and must not be described as one.
export async function inspectBundledImageSize(root) {
  let directory = root;
  for (const part of ["node_modules", "vinext", "dist", "deps", ".pnpm"]) {
    directory = path.join(directory, part);
    let info;
    try { info = await lstat(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("内嵌依赖路径无法安全核验，不能认定检查通过。");
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const findings = [];
  for (const entry of entries.filter((item) => item.name.startsWith("image-size@")).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("内嵌image-size目录需要人工核验。");
    const version = entry.name.match(/^image-size@(\d+)\.(\d+)\.(\d+)(?:_|$)/);
    const affected = version && (Number(version[1]) < 2 ||
      Number(version[1]) === 2 && Number(version[2]) === 0 && Number(version[3]) <= 2);
    let file = path.join(directory, entry.name);
    for (const part of ["deps", "image-size", "dist", "index.js"]) {
      file = path.join(file, part);
      const info = await lstat(file);
      if (info.isSymbolicLink() || (part === "index.js" ? !info.isFile() || info.size > 4 * 1024 * 1024 : !info.isDirectory())) {
        throw new Error("内嵌image-size文件无法安全核验，不能认定检查通过。");
      }
    }
    findings.push({ owner: "vinext", name: "image-size", version: version ? version.slice(1, 4).join(".") : "unrecognized",
      severity: affected ? "high" : "review", path: path.relative(root, file),
      sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
      reason: affected ? "框架内嵌已知受影响版本；npm依赖图未必列出，须核验代码及调用路径。" : "发现框架内嵌解析器，版本不在本检查的已知范围，需人工核验。",
      advisories: affected ? ["https://github.com/advisories/GHSA-w3rx-r6r6-pgpr", "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq"] : [],
    });
  }
  return findings;
}

export function hasDependencyFindings(result) {
  return result.counts.total > 0 || result.bundledFindings.length > 0;
}

// Scan every installed dependency class: Wrangler and the RSC adapter are
// devDependencies but are part of this system's actual local runtime.
export function summarizeAudit(report) {
  if (!report || report.error || report.auditReportVersion !== 2 ||
      !report.metadata?.vulnerabilities || !report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    throw new Error("未取得有效安全报告，不能认定依赖检查通过。");
  }
  const counts = report.metadata.vulnerabilities;
  const severities = ["info", "low", "moderate", "high", "critical"];
  if (severities.some((key) => !Number.isInteger(counts[key]) || counts[key] < 0) ||
      counts.total !== severities.reduce((sum, key) => sum + counts[key], 0) ||
      counts.total !== Object.keys(report.vulnerabilities).length) throw new Error("安全报告数量不一致，请重新检查。");
  return {
    checkedAt: new Date().toISOString(), scope: "全部依赖，含本地运行工具和开发工具", counts,
    packages: Object.values(report.vulnerabilities).map((entry) => ({
      name: entry.name, severity: entry.severity, direct: entry.isDirect, range: entry.range,
      nodes: entry.nodes, fix: entry.fixAvailable,
      advisories: [...new Map((entry.via || []).filter((item) => typeof item === "object")
        .map((item) => [item.url, { title: item.title, url: item.url }])).values()],
      inheritedFrom: (entry.via || []).filter((item) => typeof item === "string"),
    })),
  };
}

export async function auditDependencies({ root = fileURLToPath(new URL("..", import.meta.url)) } = {}) {
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm",
    ["audit", "--json", "--include=dev", "--include=optional", "--include=peer"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], shell: false });
  let stdout = "", stderr = "", exceeded = false;
  const timeout = setTimeout(() => child.kill("SIGTERM"), 120000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    if (stdout.length > 8 * 1024 * 1024) { exceeded = true; child.kill("SIGTERM"); }
  });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-1000); });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => signal ? reject(new Error("安全检查超时或被中断，不能作为通过结果。")) : resolve(code));
    });
    if (exceeded || ![0, 1].includes(code)) throw new Error("安全检查未完成，请核对网络和npm服务。" + (stderr ? "（npm已返回错误）" : ""));
    let report;
    try { report = JSON.parse(stdout); } catch { throw new Error("安全服务未返回有效JSON报告。"); }
    return { ...summarizeAudit(report), bundledFindings: await inspectBundledImageSize(root),
      bundledScope: "针对vinext已知内嵌image-size布局补查，不是通用内嵌代码或完整供应链扫描；counts仅为npm依赖图统计。" };
  } finally { clearTimeout(timeout); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await auditDependencies();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = hasDependencyFindings(result) ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
