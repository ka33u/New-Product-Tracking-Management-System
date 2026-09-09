import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";
import { formDefinitions } from "../lib/forms.ts";
import { sheetDefinitions } from "../lib/sheets-v2.ts";

export function validFormPayload(code) {
  const definition = formDefinitions.find((form) => form.code === code);
  return Object.fromEntries(definition.fields.map((field) => [field.key,
    field.type === "date" ? "2026-09-07" : field.type === "number" ? 1 : field.type === "checkbox" ? true
      : field.type === "select" ? field.options[0] : field.type === "multiselect" ? [field.options[0]] : `QA 合成${field.label}`]));
}

export async function checkFormRelease(database = new D1Adapter()) {
  const originals = new Map();
  const store = await buildStoreModule(database, { FILES: { async head(key) { return originals.get(key) || null; } } });
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const seed = await store.getNpdWorkspaceSnapshot(admin);
  const member = (role) => seed.users.find((user) => user.role === role).id;
  const created = await store.createNpdProject({ name: "QA 十阶段连续放行", seriesName: "QA-GATE", category: "异步电动机", source: "企业研发",
    customerId: "npd-c-001", ownerId: admin.id, processId: member("process"), procurementId: member("procurement"),
    productionId: member("production"), testerId: member("tester"), qualityId: member("quality"),
    plannedStart: "2026-09-07", plannedEnd: "2027-01-05", priority: "normal", riskLevel: "medium", description: "合成流程，非实际技术结论", orderIds: [],
    motors: seed.motors.slice(0, 2).map((motor, index) => ({ ...motor, model: `QA-GATE-${index + 1}`, plannedDate: "2027-01-05" })) }, admin);
  const projectId = created.id;
  const sheet = (code) => database.prepare("SELECT * FROM npd_project_sheets WHERE project_id=? AND code=?").bind(projectId, code).first();
  const form = (code) => database.prepare("SELECT * FROM npd_form_records WHERE project_id=? AND form_code=?").bind(projectId, code).first();
  const save = async (code, payload, submit = true) => store.saveNpdFormRecord(projectId, code, payload, submit, admin, "QA 结论放行检查", (await form(code))?.version || 0);
  const release = async (code) => store.updateProjectSheet(projectId, code, {
    status: "completed", progress: 100, plannedDate: "2027-01-05", note: "QA 隔离放行", changeReason: "QA 阶段复核", expectedVersion: (await sheet(code)).version,
  }, admin);
  async function state() {
    const rows = {};
    for (const table of ["npd_projects", "npd_project_sheets", "npd_sheet_revisions", "npd_activities", "npd_form_records", "npd_project_motors", "npd_part_items", "npd_documents", "npd_test_reports", "npd_inspection_records"]) {
      rows[table] = (await database.prepare(`SELECT * FROM ${table} WHERE ${table === "npd_projects" ? "id" : "project_id"}=? ORDER BY id`).bind(projectId).all()).results;
    }
    return JSON.stringify(rows);
  }
  async function rejectsUnchanged(action, pattern) {
    const before = await state(); await assert.rejects(action, pattern); assert.equal(await state(), before, "拒绝的提交或放行不得改变任何业务/版本/审计");
  }
  const part = await store.addPartItem({ projectId, motorId: null, partNo: "QA-GATE-PART", name: "QA通用端盖", specification: "QA", material: "QA", quantity: 1,
    sourceType: "自制", designOutputRef: "QA-DWG-A1", inspectionRequirement: "QA尺寸检验", testRequirement: "", plannedDate: "2027-01-05" }, admin);
  await store.confirmPartItem(part.id, "completed", "QA生产确认", admin, 1, (await sheet("parts_plan")).version);
  let archive = await store.getNpdProjectArchiveData(projectId, admin);
  for (const motor of archive.motors) await store.confirmMotorProduction({ motorId: motor.id, status: "completed", actualDate: "2026-09-07",
    note: "QA整机生产确认", expectedRevision: motor.designRevision, expectedSheetVersion: (await sheet("parts_plan")).version }, admin);
  async function addDocument(code, suffix) {
    const objectKey = `npd/${projectId}/${code}/${suffix}`;
    originals.set(objectKey, { size: 10, etag: `qa-${suffix}` });
    return store.insertNpdDocument({ projectId, sheetCode: code, motorId: null, linkedRecordId: null,
      kind: code === "verification" ? "test_report" : "inspection_record", fileName: `${suffix}.txt`, objectKey, contentType: "text/plain", size: 10 }, admin);
  }
  for (const [index, motor] of archive.motors.entries()) {
    await store.createTestReport({ projectId, motorId: motor.id, expectedRevision: motor.designRevision, reportNo: `QA-GATE-T${index}`,
      reportType: "型式试验", title: "QA合成试验", requirementRef: motor.testRequirement, testDate: "2026-09-07", result: "合格", conclusion: "QA合成结论",
      documentId: await addDocument("verification", `test-${index}`) }, admin);
  }
  for (const [index, { row, type }] of [...archive.motors.map((row) => ({ row, type: "motor" })), ...archive.parts.map((row) => ({ row, type: "part" }))].entries()) {
    await store.createInspectionRecord({ projectId, motorId: type === "motor" ? row.id : null, partItemId: type === "part" ? row.id : null, itemType: type,
      expectedRevision: row.designRevision, inspectionDate: "2026-09-07", result: "合格", conclusion: "QA合成结论", documentId: await addDocument("quality_inspection", `inspection-${index}`) }, admin);
  }
  const decisions = {
    "HD/JL-SJ-05A1": { field: "conclusion", negative: "不通过", conditional: "有条件通过", closure: ["trackingResult", "verifier", "verifyDate"] },
    "HD/JL-SJ-06A1": { field: "conclusion", negative: "不通过", conditional: "有条件通过", closure: ["followUp"] },
    "HD/JL-SJ-08A1": { field: "massProductionOpinion", negative: "不同意", conditional: "整改后批量生产", closure: ["correctiveActions"] },
    "HD/JL-SJ-10A1": { field: "technicalConclusion", negative: "不通过", conditional: "整改后确认", closure: ["reviewSummary"] },
  };
  for (const stage of sheetDefinitions) {
    for (const code of stage.formCodes) {
      const valid = validFormPayload(code);
      const definition = formDefinitions.find((item) => item.code === code);
      const required = definition.fields.find((field) => field.required);
      await rejectsUnchanged(() => save(code, { ...valid, [required.key]: "  " }), /未填写/);
      const recordField = definition.fields.find((field) => field.type === "text");
      await rejectsUnchanged(() => save(code, { ...valid, [recordField.key]: { invalid: true } }), /文字/);
      for (const field of definition.fields.filter((field) => field.type === "date")) {
        await rejectsUnchanged(() => save(code, { ...valid, [field.key]: "2026-02-30" }), /有效日期/);
      }
      for (const field of definition.fields.filter((field) => field.type === "select" || field.type === "multiselect")) {
        await rejectsUnchanged(() => save(code, { ...valid, [field.key]: field.type === "select" ? "不存在的选项" : ["不存在的选项"] }), /选项/);
      }
      await save(code, { ...valid, [required.key]: "" }, false);
      assert.equal((await form(code)).status, "draft", "未完成记录可保存草稿");
      await save(code, { ...valid, legacyExtension: "未知历史字段原样保留" });
      assert.equal(JSON.parse((await form(code)).payload).legacyExtension, "未知历史字段原样保留");
    }
    for (const code of stage.formCodes.filter((item) => decisions[item])) {
      const valid = validFormPayload(code), decision = decisions[code];
      await save(code, { ...valid, [decision.field]: decision.negative });
      assert.equal((await form(code)).status, "submitted", "失败结论也应可提交留痕，不得强迫改成通过");
      await rejectsUnchanged(() => release(stage.code), new RegExp(decision.negative));
      const pending = { ...valid, [decision.field]: decision.conditional, ...Object.fromEntries(decision.closure.map((key) => [key, ""])) };
      await save(code, pending);
      await rejectsUnchanged(() => release(stage.code), /须补充|整改确认依据/);
      await save(code, { ...valid, [decision.field]: decision.conditional });
    }
    if (stage.code === "initiation") {
      // Simulate previously stored malformed submissions without rewriting history.
      const current = await form(stage.formCodes[0]);
      for (const invalid of ["{broken", "null", "[]", JSON.stringify({ ...validFormPayload(current.form_code), initiationDate: "2026-02-30" })]) {
        await database.prepare("UPDATE npd_form_records SET payload=? WHERE id=?").bind(invalid, current.id).run();
        await rejectsUnchanged(() => release(stage.code), /无法读取|不能放行/);
      }
      await save(current.form_code, validFormPayload(current.form_code));
    }
    await release(stage.code);
    assert.equal((await sheet(stage.code)).status, "completed", `${stage.code}应在全部前置及证据成立后正常放行`);
  }
  archive = await store.getNpdProjectArchiveData(projectId, admin);
  assert.equal(archive.project.status, "completed"); assert.equal(archive.project.progress, 100);
  assert.equal(archive.sheets.filter((item) => item.status === "completed").length, 10);
  assert.equal(archive.forms.length, 10);
  assert.ok(archive.revisions.some((revision) => revision.snapshotJson.includes('不通过')), "不通过结论保留在历史快照");
  // A failed re-review after completion reopens the project and every downstream gate.
  const code = "HD/JL-SJ-05A1";
  await save(code, { ...validFormPayload(code), conclusion: "不通过" });
  await rejectsUnchanged(() => release("design_review"), /不通过/);
  archive = await store.getNpdProjectArchiveData(projectId, admin);
  assert.equal(archive.project.status, "active");
  assert.equal(archive.project.actualEnd, null);
  assert.equal(archive.sheets.filter((item) => item.status === "pending_review").length, 7);
  await save(code, validFormPayload(code));
  for (const stage of sheetDefinitions.filter((item) => item.index >= 4)) await release(stage.code);
  archive = await store.getNpdProjectArchiveData(projectId, admin);
  assert.equal(archive.project.status, "completed"); assert.equal(archive.project.progress, 100);
  assert.equal(archive.tests.length, 2); assert.equal(archive.inspections.length, 3); assert.equal(archive.documents.length, 5);
  console.log("十阶段连续放行通过：十表单校验、失败结论留痕且禁止放行、四类有条件结论闭环、历史非法载荷、原件核验路径（合成元数据）、项目100%、复评失败重开及逐阶段再放行。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkFormRelease();
