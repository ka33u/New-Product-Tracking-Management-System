import assert from "node:assert/strict";
import JSZip from "jszip";
import { sheetDefinitions } from "../lib/sheets-v2.ts";
import { validFormPayload } from "./form-release.mjs";

// The caller owns a fresh temporary service/database; never point at live 3011.
export async function checkFormReleaseHttp({ request, action, cookie, base, staff, customerId, ownerId }) {
  const created = await action("create_project", { name: "QA HTTP 十阶段连续验收", seriesName: "QA-HTTP-GATE", category: "异步电动机", source: "企业研发",
    customerId, ownerId, processId: staff.process, procurementId: staff.procurement, productionId: staff.production, testerId: staff.tester, qualityId: staff.quality,
    plannedStart: "2026-09-07", plannedEnd: "2027-01-05", priority: "normal", riskLevel: "medium", description: "独立运行测试，非业务结论", orderIds: [],
    motors: [{ model: "QA-HTTP-GATE-1", ratedPower: "5.5kW", voltage: "380V", frequency: "50Hz", mounting: "B3", terminalMode: "顶部出线",
      protectionGrade: "IP55", insulationClass: "F", coolingMethod: "IC411", quantity: 1, inspectionRequirement: "QA整机检验", testRequirement: "QA型式试验", plannedDate: "2027-01-05" }] });
  const projectId = created.result.id;
  const snapshot = async () => (await (await request("/api/workspace", { headers: { Cookie: cookie } })).json()).snapshot;
  const currentSheet = async (code) => (await snapshot()).sheets.find((row) => row.projectId === projectId && row.code === code);
  const currentForm = async (code) => (await snapshot()).formRecords.find((row) => row.projectId === projectId && row.formCode === code);
  const save = async (code, payload) => action("save_form", { projectId, formCode: code, formPayload: payload, submit: true,
    changeReason: "QA复核留痕", expectedVersion: (await currentForm(code))?.version || 0 });
  const sheetPayload = async (code) => ({ projectId, sheetCode: code, status: "completed", progress: 100, plannedDate: "2027-01-05",
    note: "QA运行时放行", changeReason: "QA全部交付复核", expectedVersion: (await currentSheet(code)).version });
  const rejected = async (kind, payload, pattern) => {
    const before = await snapshot();
    const response = await request("/api/action", { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ kind, payload }) });
    assert.equal(response.status, 400); assert.match((await response.json()).error, pattern);
    const after = await snapshot();
    for (const key of ["projects", "sheets", "formRecords", "sheetRevisions", "activities", "documents", "testReports", "inspections"]) assert.deepEqual(after[key], before[key], `${key}:失败请求零写入`);
  };
  await rejected("save_form", { projectId, formCode: "HD/JL-SJ-01A1", formPayload: { ...validFormPayload("HD/JL-SJ-01A1"), initiationDate: "2026-02-30" }, submit: true, expectedVersion: 0 }, /有效日期/);
  const part = await action("add_part", { projectId, motorId: null, partNo: "QA-HTTP-P1", name: "QA端盖", specification: "QA", material: "QA", quantity: 1, sourceType: "自制",
    designOutputRef: "QA-DWG-1", inspectionRequirement: "QA零部件检验", testRequirement: "", plannedDate: "2027-01-05" });
  await action("confirm_part", { partId: part.result.id, expectedRevision: 1, expectedSheetVersion: (await currentSheet("parts_plan")).version, status: "completed", note: "QA确认" });
  const motor = (await snapshot()).motors.find((row) => row.projectId === projectId);
  await rejected("confirm_motor", { motorId: motor.id, status: "completed", actualDate: "2099-01-01", note: "QA非法未来日期", expectedRevision: 1,
    expectedSheetVersion: (await currentSheet("parts_plan")).version }, /不能晚于今天/);
  await action("confirm_motor", { motorId: motor.id, status: "completed", actualDate: "2026-09-07", note: "QA整机确认", expectedRevision: 1,
    expectedSheetVersion: (await currentSheet("parts_plan")).version });
  const confirmedMotor = (await snapshot()).motors.find((row) => row.id === motor.id);
  assert.ok(confirmedMotor.confirmedByName && confirmedMotor.confirmedAt);
  assert.equal(confirmedMotor.productionNote, "QA整机确认");
  const originals = new Map();
  async function upload(code, name) {
    const bytes = new TextEncoder().encode(`QA合成原件 ${name}`), body = new FormData();
    body.set("file", new File([bytes], `${name}.txt`, { type: "text/plain" })); body.set("projectId", projectId); body.set("sheetCode", code);
    const response = await request("/api/files", { method: "POST", headers: { Cookie: cookie, Origin: base }, body });
    const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); originals.set(data.id, bytes); return data.id;
  }
  const assertOriginalRetained = async id => {
    const response = await request(`/api/files/${id}`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), originals.get(id));
  };
  const report = { projectId, motorId: motor.id, expectedRevision: 1, reportNo: "QA-HTTP-TR1", reportType: "型式试验", title: "QA合成型式报告",
    requirementRef: motor.testRequirement, testDate: "2026-09-07", result: "合格", conclusion: "QA合成结论", documentId: await upload("verification", "型式试验") };
  await rejected("create_test_report", { ...report, result: "有条件合格", conclusion: "" }, /限制条件及处置依据/);
  await assertOriginalRetained(report.documentId);
  await action("create_test_report", report);
  for (const type of ["motor", "part"]) {
    const inspection = { projectId, itemType: type, motorId: type === "motor" ? motor.id : null, partItemId: type === "part" ? part.result.id : null,
      expectedRevision: 1, inspectionDate: "2026-09-07", result: "合格", conclusion: "QA合成结论", documentId: await upload("quality_inspection", type) };
    await rejected("create_inspection", { ...inspection, result: "让步接收", conclusion: "" }, /处置依据及适用限制/);
    await assertOriginalRetained(inspection.documentId);
    await action("create_inspection", inspection);
  }
  const evidence = await snapshot();
  assert.equal(evidence.documents.filter(row => row.projectId === projectId).length, 3);
  assert.equal(evidence.testReports.filter(row => row.projectId === projectId).length, 1);
  assert.equal(evidence.inspections.filter(row => row.projectId === projectId).length, 2);
  console.log("两步提交HTTP通过：三份附件上传后记录校验失败，原件仍可完整下载；补正复用同一文件ID，只生成一份试验和两份检验记录，无重复附件。");
  for (const stage of sheetDefinitions) {
    for (const code of stage.formCodes) await save(code, validFormPayload(code));
    if (stage.code === "design_review") {
      await save("HD/JL-SJ-05A1", { ...validFormPayload("HD/JL-SJ-05A1"), conclusion: "不通过" });
      await rejected("update_sheet", await sheetPayload(stage.code), /不通过/);
      await save("HD/JL-SJ-05A1", validFormPayload("HD/JL-SJ-05A1"));
    }
    await action("update_sheet", await sheetPayload(stage.code));
  }
  const final = await snapshot();
  assert.equal(final.projects.find((row) => row.id === projectId).status, "completed");
  assert.equal(final.projects.find((row) => row.id === projectId).progress, 100);
  assert.equal(final.sheets.filter((row) => row.projectId === projectId && row.status === "completed").length, 10);
  for (const code of ["verification", "quality_inspection"]) {
    const revision = final.sheetRevisions.filter((row) => row.projectId === projectId && row.sheetCode === code).sort((a, b) => b.version - a.version)[0];
    const detail = await (await request(`/api/revisions/${revision.id}`, { headers: { Cookie: cookie } })).json();
    const receipts = detail.snapshot.evidenceOriginals;
    assert.equal(receipts.length, code === "verification" ? 1 : 2);
    for (const receipt of receipts) assert.equal(receipt.size, originals.get(receipt.documentId).length);
  }
  const response = await request(`/api/export/project/${projectId}?format=bundle`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const bundle = await JSZip.loadAsync(await response.arrayBuffer(), { checkCRC32: true });
  const manifest = JSON.parse(await bundle.file("04_附件清单.json").async("string"));
  assert.equal(manifest.attachmentCount, 3); assert.equal(manifest.stageVersions.length, 10);
  console.log("十阶段生产HTTP通过：十份受控表单、日期拒绝、失败评审零写入、生产确认、三份真实R2合成原件核验凭据、阶段100%与ZIP归档。");
}
