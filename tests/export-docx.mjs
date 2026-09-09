import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";
const require = createRequire(import.meta.url);
const runtimeRequire = process.env.NPD_ARTIFACT_MODULES ? createRequire(`${process.env.NPD_ARTIFACT_MODULES}/docx/package.json`) : require;
const ts = require("typescript");
const JSZip = runtimeRequire("jszip");
const imports = { docx: pathToFileURL(runtimeRequire.resolve("docx").replace(/index\.(?:umd\.)?cjs$/, "index.mjs")).href };
async function compile(name) {
  let code = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [key, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(key), JSON.stringify(url));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  imports[`./${name}`] = url;
  return import(url);
}
await compile("npd-v2"); await compile("forms"); await compile("sheets-v2");
const runtime = await compile("docx-runtime");
const exporter = await compile("word-archive");
assert.equal(runtime.wordText(false), "否"); assert.equal(runtime.wordText(0), "0");
assert.throws(() => runtime.wordText("bad\u0000text"), /控制字符/);
assert.throws(() => runtime.wordText("bad\uD800text"), /无效Unicode/);
assert.equal(runtime.wordText("电机𠮷"), "电机𠮷");
assert.equal(runtime.wordText([]), "未选择");
assert.match(exporter.archiveTimestamp("2026-09-06 00:01:02"), /08:01:02/);
const database = new D1Adapter();
const store = await buildStoreModule(database);
await store.ensureNpdDatabase();
const admin = await store.resolveNpdCurrentUser(null, null);
const motor = (await store.getNpdProjectArchiveData("npd-p-001", admin)).motors[0];
const production = (await store.getNpdWorkspaceSnapshot(admin)).users.find((user) => user.role === "production");
await store.confirmMotorProduction({ motorId: motor.id, status: "completed", actualDate: "2026-09-07", note: "QA整机确认 <复核> & 追溯\n第二行生产说明",
  expectedRevision: motor.designRevision, expectedSheetVersion: (await database.prepare("SELECT version FROM npd_project_sheets WHERE project_id='npd-p-001' AND code='parts_plan'").first()).version }, production);
await database.prepare("UPDATE npd_project_motors SET confirmed_at='2026-09-07 00:01:02' WHERE id=?").bind(motor.id).run();
const data = await store.getNpdProjectArchiveData("npd-p-001", admin);
assert.ok(data.motors.length >= 2);
Object.assign(data.motors[1], { status: "completed", actualDate: "2026-09-06", confirmedBy: null, confirmedAt: null });
data.project.name = "HE5 高效电机系列开发";
data.forms[0].payload.legacy_zero = 0;
data.forms[0].payload.legacy_false = false;
data.forms[0].payload.legacy_note = "第一行中文 <试验> & 引用\n第二行记录";
const reportFileName = "HE5-132S-4高效电机型式试验报告_设计变更后温升及绝缘性能复核_R2.pdf";
data.documents.push({ id: "qa-report-index", projectId: data.project.id, sheetCode: "verification", motorId: data.motors[0].id,
  linkedRecordId: data.tests[0]?.id || null, kind: "型式试验报告", fileName: reportFileName, objectKey: "synthetic/qa-report-index",
  contentType: "application/pdf", size: 1024, version: "R2", uploadedBy: admin.id, uploadedByName: "归档验证员", createdAt: "2026-09-06 00:01:02" });
if (data.tests[0]) Object.assign(data.tests[0], { documentId: "qa-report-index", fileName: reportFileName });
const outputs = [
  ["project.docx", data, undefined],
  ["verification.docx", data, "verification"],
  ["production.docx", data, "parts_plan"],
  ["empty-quality.docx", { ...data, forms: [], sheets: [], revisions: [], inspections: [], documents: [] }, "quality_inspection"],
];
if (process.env.NPD_DOCX_QA_PREP) {
  await mkdir(process.env.NPD_DOCX_QA_PREP, { recursive: true });
  await writeFile(`${process.env.NPD_DOCX_QA_PREP}/inputs.json`, JSON.stringify({ moduleUrl: imports["./word-archive"], outputs }));
  console.log("文档验证输入与应用模块已准备；尚未生成DOCX。");
  process.exit(0);
}
for (const [name, archive, onlySheet] of outputs) {
  const blob = await exporter.buildProjectWord(archive, onlySheet, "归档验证员");
  assert.ok(blob instanceof Blob); assert.ok(blob.size > 5000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
  const zip = await JSZip.loadAsync(bytes);
  assert.ok(zip.file("[Content_Types].xml")); assert.ok(zip.file("word/styles.xml"));
  const xml = await zip.file("word/document.xml").async("string");
  assert.match(xml, /w:pStyle w:val="Title"/);
  assert.match(xml, /w:w="11906" w:h="16838"/);
  assert.match(xml, /归档验证员/);
  assert.doesNotMatch(xml, /<html|<script/);
  if (name === "project.docx") {
    for (let i = 1; i <= 10; i++) assert.ok(xml.includes(`HD/JL-SJ-${String(i).padStart(2, "0")}A1`));
    for (const value of ["出线形式", "防护等级", "绝缘等级", "冷却方式", "legacy_zero", "legacy_false", "第一行中文 &lt;试验&gt; &amp; 引用", "第二行记录", "版本与修改记录", "项目操作日志"]) assert.ok(xml.includes(value), value);
    assert.match(xml, /w:tblHeader/);
  }
  if (onlySheet === "verification") {
    assert.ok(xml.includes("HD/JL-SJ-06A1")); assert.ok(!xml.includes("HD/JL-SJ-01A1"));
    assert.ok(xml.includes(reportFileName)); assert.ok(xml.includes("08:01:02"));
  }
  if (onlySheet === "quality_inspection") assert.ok(xml.includes("暂无检验记录"));
  if (!onlySheet || onlySheet === "parts_plan") {
    for (const value of ["整机生产节点", "生产确认人", "生产确认时间", "生产确认说明", production.name, "QA整机确认 &lt;复核&gt; &amp; 追溯", "第二行生产说明", "08:01:02", "历史完工 · 待生产复核", "生产已完成"]) assert.ok(xml.includes(value), value);
    for (const item of data.motors) assert.ok(xml.includes(item.model), "同系列所有规格都必须收录生产节点");
  }
  if (onlySheet === "parts_plan") assert.doesNotMatch(xml, /HD\/JL-SJ-01A1|HD\/JL-SJ-06A1/, "单Sheet不混入其他阶段表单");
  const styles = await zip.file("word/styles.xml").async("string");
  assert.match(styles, /宋体/);
  assert.ok(Object.keys(zip.files).some((part) => /^word\/footer\d+\.xml$/.test(part)));
  if (process.env.NPD_DOCX_QA_DIR) {
    await mkdir(process.env.NPD_DOCX_QA_DIR, { recursive: true });
    await writeFile(`${process.env.NPD_DOCX_QA_DIR}/${name}`, bytes);
  }
}
console.log("DOCX结构与内容通过：完整项目及单Sheet原生格式、十表单、规格字段、历史扩展字段、中文转义、空白阶段、表头和页码。");
