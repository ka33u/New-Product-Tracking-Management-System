import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

const require = createRequire(import.meta.url);
const writerUrl = pathToFileURL(require.resolve("write-excel-file/universal")).href;
const writerRequire = createRequire(writerUrl);
const { unzipSync, strFromU8 } = writerRequire("fflate");
const imports = { "write-excel-file/universal": writerUrl };
async function compile(name) {
  let code = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [key, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(key), JSON.stringify(url));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  imports[`./${name}`] = url;
  return import(url);
}
await compile("forms"); await compile("npd-v2"); await compile("sheets-v2");
const runtime = await compile("xlsx-runtime");
const exporter = await compile("export-v2");

const db = new D1Adapter();
const store = await buildStoreModule(db);
await store.ensureNpdDatabase();
const admin = await store.resolveNpdCurrentUser(null, null);
const projectId = "npd-p-001";
const confirmationMotor = (await store.getNpdProjectArchiveData(projectId, admin)).motors[0];
const production = (await store.getNpdWorkspaceSnapshot(admin)).users.find((user) => user.role === "production");
await store.confirmMotorProduction({ motorId: confirmationMotor.id, status: "completed", actualDate: "2026-09-07", note: "QA整机确认<&>\n第二行说明",
  expectedRevision: confirmationMotor.designRevision, expectedSheetVersion: db.database.prepare("SELECT version FROM npd_project_sheets WHERE project_id=? AND code='parts_plan'").get(projectId).version }, production);
db.database.prepare("UPDATE npd_project_motors SET confirmed_at='2026-09-07 00:01:02' WHERE id=?").run(confirmationMotor.id);
// More than the old global feed limit, including same-second timestamps.
const insert = db.database.prepare(`INSERT INTO npd_activities
  (id,project_id,actor_id,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,'测试','project',?,'完整日志测试','2020-01-01 00:00:00')`);
for (let i = 0; i < 351; i++) insert.run(`xlsx-audit-${i}`, projectId, admin.id, projectId);
const archive = await store.getNpdProjectArchiveData(projectId, admin);
assert.ok(archive.motors.length >= 2);
Object.assign(archive.motors[1], { status: "completed", actualDate: "2026-09-06", confirmedBy: null, confirmedAt: null });
assert.equal(archive.activities.length, db.database.prepare("SELECT count(*) AS n FROM npd_activities WHERE project_id=?").get(projectId).n);
assert.ok(archive.activities.some((event) => event.id === "xlsx-audit-0"));
assert.ok(archive.revisions.every((revision) => revision.snapshotJson));
const outsider = await store.createNpdUser({ email: "xlsx-outside@example.test", name: "导出隔离", role: "quality", department: "测试", active: true, password: "OnlyTest2026" }, admin);
await assert.rejects(() => store.getNpdProjectArchiveData(projectId, outsider), /无权|不存在/);

archive.project.name = '=HYPERLINK("https://example.invalid","不能执行")';
archive.project.progress = 25;
archive.project.plannedStart = "2026-09-06";
archive.project.updatedAt = "2026-09-06 00:01:02";
archive.forms[0].payload.legacy_zero = 0;
archive.forms[0].payload.legacy_false = false;
archive.forms[0].payload.legacy_chinese = "第一行中文<&>\n第二行";
const originalSnapshot = JSON.stringify({ long: "复😀".repeat(19000) });
archive.revisions[0].snapshotJson = originalSnapshot;
const chunks = exporter.revisionSnapshotRows({ revisions: [archive.revisions[0]] }).slice(1);
assert.ok(chunks.length > 1);
assert.equal(chunks.map((row) => row[4]).join(""), originalSnapshot);
assert.ok(chunks.every((row) => row[4].length <= 32767));

assert.equal(runtime.excelDate("2026-09-06", false).toISOString(), "2026-09-06T00:00:00.000Z");
assert.equal(runtime.excelDate("2026-09-06 00:01:02", true).toISOString(), "2026-09-06T08:01:02.000Z");
assert.equal(runtime.excelDate("2026-09-06T08:01:02+08:00", true).toISOString(), "2026-09-06T08:01:02.000Z");
assert.equal(runtime.excelDate("2026-02-30", false), null);
assert.throws(() => runtime.worksheet("长文字", [["内容"], ["文".repeat(32768)]]), /上限/);
assert.throws(() => runtime.worksheet("数值", [["金额"], [Infinity]]), /无效数值/);

const snapshot = await store.getNpdWorkspaceSnapshot(admin);
const projectBlob = await exporter.buildProjectExcel(archive);
const portfolioBlob = await exporter.buildPortfolioExcel(snapshot, admin);
const outsideBlob = await exporter.buildPortfolioExcel(await store.getNpdWorkspaceSnapshot(outsider), outsider);
for (const blob of [projectBlob, portfolioBlob, outsideBlob]) {
  assert.ok(blob.size > 1000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
  const zip = unzipSync(bytes);
  assert.ok(zip["[Content_Types].xml"] && zip["xl/workbook.xml"]);
  for (const [name, content] of Object.entries(zip)) {
    if (name.startsWith("xl/worksheets/") && name.endsWith(".xml")) assert.doesNotMatch(strFromU8(content), /<f[\s>]/, "用户文字不得变成公式");
  }
}
const projectZip = unzipSync(new Uint8Array(await projectBlob.arrayBuffer()));
const workbookXml = strFromU8(projectZip["xl/workbook.xml"]);
assert.equal((workbookXml.match(/<sheet /g) || []).length, 14);
assert.match(workbookXml, /版本数据快照/);
assert.match(strFromU8(projectZip["xl/worksheets/sheet1.xml"]), /<v>0\.25<\/v>/);
assert.match(strFromU8(projectZip["xl/styles.xml"]), /0%/);
const allXml = Object.values(projectZip).map((bytes) => strFromU8(bytes)).join("\n");
assert.match(allXml, /HYPERLINK/);
assert.match(allXml, /legacy_zero/);
assert.match(allXml, /legacy_false/);
assert.match(allXml, /第一行中文/);
assert.match(allXml, /生产确认人/); assert.match(allXml, /生产确认时间/); assert.match(allXml, /生产确认说明/);
assert.match(allXml, /历史完工 · 待生产复核/); assert.match(allXml, /生产已完成/);
assert.ok(allXml.includes(production.name)); assert.match(allXml, /QA整机确认&lt;&amp;&gt;/); assert.match(allXml, /第二行说明/);
const motorXml = strFromU8(projectZip["xl/worksheets/sheet2.xml"]);
const confirmationCell = motorXml.match(/<c\b([^>]*\br="V2"[^>]*)>(.*?)<\/c>/s);
assert.ok(confirmationCell, "整机确认时间必须在规格表正确列中");
assert.doesNotMatch(confirmationCell[1], /t="(?:s|inlineStr)"/, "确认时间必须为北京时间日期单元格，不是未转换UTC文字");
const serial = Number(confirmationCell[2].match(/<v>(.*?)<\/v>/)?.[1]);
const expectedSerial = (Date.parse("2026-09-07T08:01:02Z") - Date.parse("1899-12-30T00:00:00Z")) / 86400000;
assert.ok(Math.abs(serial - expectedSerial) < 1e-8, "确认时间与页面/Word统一为北京时间且保留秒");

if (process.env.NPD_EXPORT_QA_DIR) {
  await mkdir(process.env.NPD_EXPORT_QA_DIR, { recursive: true });
  await writeFile(`${process.env.NPD_EXPORT_QA_DIR}/project.xlsx`, new Uint8Array(await projectBlob.arrayBuffer()));
  await writeFile(`${process.env.NPD_EXPORT_QA_DIR}/portfolio.xlsx`, new Uint8Array(await portfolioBlob.arrayBuffer()));
}
db.database.close();
console.log("XLSX导出通过：14页项目档案、4页概览、数字日期类型、公式注入防护、历史字段、长快照无损分段、超过300条日志及项目权限隔离。");
