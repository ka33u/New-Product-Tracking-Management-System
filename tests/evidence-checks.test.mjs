import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../lib/evidence-checks.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { motorTestIssues, targetInspectionEvidence, evidenceStageStatus } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const motor = { id: "m", projectId: "p", designRevision: 2, testRequirement: "当前试验要求" };
const document = { id: "d", projectId: "p", sheetCode: "verification" };
const report = (overrides = {}) => ({ id: "r", projectId: "p", motorId: "m", requirementRevision: 2, reportType: "型式试验",
  result: "合格", conclusion: "满足要求", requirementRef: "当前试验要求", documentId: "d", ...overrides });

test("evidence presentation distinguishes completed, reopened, blocked and unknown stages", () => {
  assert.deepEqual(evidenceStageStatus("completed", true), { value: "completed", label: "证据齐套 · 阶段已完成" });
  assert.deepEqual(evidenceStageStatus("completed", false), { value: "blocked", label: "证据待补齐 · 完成状态需复核" });
  for (const status of ["not_started", "in_progress", "pending_review"]) {
    assert.deepEqual(evidenceStageStatus(status, true), { value: "pending_review", label: "证据齐套 · 待阶段复核" });
    assert.equal(evidenceStageStatus(status, false).label, "证据待补齐");
  }
  assert.deepEqual(evidenceStageStatus("blocked", true), { value: "blocked", label: "证据齐套 · 阶段受阻" });
  for (const status of [undefined, "legacy", ""]) assert.deepEqual(evidenceStageStatus(status, true), {
    value: "pending_review", label: "证据齐套 · 阶段状态待确认",
  });
});

test("a different passing report category cannot mask an outstanding failure", () => {
  const issues = motorTestIssues(motor, [report({ reportType: "性能试验" }), report({ result: "不合格" })], [document]);
  assert.deepEqual(issues, ["型式试验不合格"]);
});
test("current revision, actual evidence, requirements and conditional basis are required", () => {
  assert.match(motorTestIssues(motor, [report({ requirementRevision: 1 })], [document]).join(), /尚无试验报告/);
  assert.match(motorTestIssues(motor, [report()], [{ ...document, projectId: "other" }]).join(), /缺少报告附件/);
  assert.match(motorTestIssues(motor, [report()], [{ ...document, sheetCode: "quality_inspection" }]).join(), /缺少报告附件/);
  assert.match(motorTestIssues(motor, [report({ requirementRef: "旧要求" })], [document]).join(), /要求.*不一致/);
  assert.match(motorTestIssues(motor, [report({ result: "有条件合格", conclusion: " " })], [document]).join(), /缺少处置依据/);
  assert.deepEqual(motorTestIssues(motor, [report()], [document]), []);
});
test("latest submission per category supersedes only that category, even with an older test date", () => {
  const newest = report({ id: "new", testDate: "2020-01-01", result: "不合格" });
  const earlier = report({ id: "old", testDate: "2026-09-06" });
  assert.deepEqual(motorTestIssues(motor, [newest, earlier], [document]), ["型式试验不合格"]);
  assert.deepEqual(motorTestIssues(motor, [report({ id: "retest" }), newest, earlier], [document]), []);
});

const target = { ...motor, inspectionRequirement: "尺寸全检" };
const qualityDoc = { ...document, sheetCode: "quality_inspection" };
const inspection = (overrides = {}) => ({ id: "i", projectId: "p", itemType: "motor", motorId: "m", partItemId: null,
  requirementRevision: 2, inspectionRequirement: "尺寸全检", result: "合格", conclusion: "满足要求", documentId: "d", ...overrides });
test("quality coverage uses the latest result and never substitutes an earlier pass", () => {
  const current = inspection({ id: "new", result: "不合格" });
  const result = targetInspectionEvidence(target, "motor", [current, inspection({ id: "old" })], [qualityDoc]);
  assert.equal(result.record.id, "new");
  assert.deepEqual(result.issues, ["最新检验结论不合格"]);
  assert.deepEqual(targetInspectionEvidence(target, "motor", [inspection(), current], [qualityDoc]).issues, []);
});
test("quality evidence must target exactly one current-revision object and have matching supporting documents", () => {
  for (const item of [inspection({ requirementRevision: 1 }), inspection({ motorId: "other" }), inspection({ partItemId: "part" }), inspection({ projectId: "other" })]) {
    assert.match(targetInspectionEvidence(target, "motor", [item], [qualityDoc]).issues.join(), /尚无检验记录/);
  }
  assert.match(targetInspectionEvidence(target, "motor", [inspection()], [document]).issues.join(), /缺少检验附件/);
  assert.match(targetInspectionEvidence(target, "motor", [inspection({ result: "让步接收", conclusion: " " })], [qualityDoc]).issues.join(), /缺少让步接收依据/);
  assert.match(targetInspectionEvidence(target, "motor", [inspection({ inspectionRequirement: "旧要求" })], [qualityDoc]).issues.join(), /不一致/);
  const part = { ...target, id: "part" };
  const partRecord = inspection({ itemType: "part", motorId: null, partItemId: "part" });
  assert.deepEqual(targetInspectionEvidence(part, "part", [partRecord], [qualityDoc]).issues, []);
  assert.match(targetInspectionEvidence({ ...part, inspectionRequirement: "" }, "part", [partRecord], [qualityDoc]).issues.join(), /不一致/);
});
