import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAudit, inspectBundledImageSize, hasDependencyFindings } from "../scripts/audit-dependencies.mjs";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const empty = () => ({ auditReportVersion: 2, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } }, vulnerabilities: {} });
test("audit errors and malformed/truncated responses never become a clean result", () => {
  for (const report of [null, {}, { ...empty(), error: { code: "ENETUNREACH" } }, { ...empty(), auditReportVersion: 1 }]) {
    assert.throws(() => summarizeAudit(report), /有效安全报告/);
  }
  const mismatch = empty(); mismatch.metadata.vulnerabilities.total = 1;
  assert.throws(() => summarizeAudit(mismatch), /数量不一致/);
  assert.equal(summarizeAudit(empty()).counts.total, 0);
});
test("audit preserves indirect and direct runtime risks without silently suppressing dev dependencies", () => {
  const report = empty(); report.metadata.vulnerabilities.high = 2; report.metadata.vulnerabilities.total = 2;
  report.vulnerabilities = {
    "runtime-adapter": { name: "runtime-adapter", severity: "high", isDirect: true, range: "<2", nodes: ["node_modules/runtime-adapter"], via: ["parser"], fixAvailable: false },
    parser: { name: "parser", severity: "high", isDirect: false, range: "<1.2", nodes: ["node_modules/parser"], via: [{ title: "Parser flaw", url: "https://example.test/advisory" }, { title: "Parser flaw", url: "https://example.test/advisory" }], fixAvailable: true },
  };
  const result = summarizeAudit(report);
  assert.equal(result.packages.length, 2);
  assert.deepEqual(result.packages[0].inheritedFrom, ["parser"]);
  assert.equal(result.packages[1].advisories.length, 1);
  assert.equal(result.packages[0].fix, false);
});

test("bundled vulnerable parsers remain a failing finding even when npm reports zero vulnerabilities", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "npd-bundled-audit-"));
  assert.deepEqual(await inspectBundledImageSize(root), []);
  const location = path.join(root, "node_modules/vinext/dist/deps/.pnpm/image-size@2.0.2/deps/image-size/dist");
  await mkdir(location, { recursive: true }); await writeFile(path.join(location, "index.js"), "synthetic test fixture; not executed");
  const bundledFindings = await inspectBundledImageSize(root);
  assert.equal(bundledFindings.length, 1);
  assert.equal(bundledFindings[0].severity, "high"); assert.equal(bundledFindings[0].version, "2.0.2");
  assert.equal(bundledFindings[0].advisories.length, 2); assert.match(bundledFindings[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(hasDependencyFindings({ ...summarizeAudit(empty()), bundledFindings }), true);
  assert.equal(hasDependencyFindings({ ...summarizeAudit(empty()), bundledFindings: [] }), false);
});

test("new bundled versions require review and unsafe symlink layouts are not silently treated as clean", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "npd-bundled-review-"));
  const location = path.join(root, "node_modules/vinext/dist/deps/.pnpm/image-size@9.0.0/deps/image-size/dist");
  await mkdir(location, { recursive: true }); await writeFile(path.join(location, "index.js"), "synthetic future version");
  const findings = await inspectBundledImageSize(root);
  assert.equal(findings[0].severity, "review"); assert.equal(findings[0].advisories.length, 0);
  const linked = await mkdtemp(path.join(tmpdir(), "npd-bundled-link-"));
  await symlink(path.join(root, "node_modules"), path.join(linked, "node_modules"));
  await assert.rejects(() => inspectBundledImageSize(linked), /安全核验/);
});
