import type { InspectionRecord, NpdDocument, PartItem, ProjectMotor, TestReport } from "./npd-v2";

// Presentation only: evidence coverage does not grant or change stage approval.
export function evidenceStageStatus(stageStatus: string | undefined, ready: boolean) {
  if (!ready) return { value: "blocked", label: stageStatus === "completed"
    ? "证据待补齐 · 完成状态需复核" : "证据待补齐" };
  if (stageStatus === "completed") return { value: "completed", label: "证据齐套 · 阶段已完成" };
  if (stageStatus === "blocked") return { value: "blocked", label: "证据齐套 · 阶段受阻" };
  if (["not_started", "in_progress", "pending_review"].includes(stageStatus || "")) {
    return { value: "pending_review", label: "证据齐套 · 待阶段复核" };
  }
  return { value: "pending_review", label: "证据齐套 · 阶段状态待确认" };
}

export interface TestEvidence {
  type: string; result: string; hasAttachment: boolean; conclusion: string; requirementRef: string;
}
// Callers supply the latest submission of each report type at the current design revision.
export function testEvidenceIssues(requirement: string, latest: TestEvidence[]): string[] {
  const problems: string[] = [];
  if (!latest.length) problems.push("当前设计版次尚无试验报告");
  for (const report of latest) {
    const type = report.type;
    if (!["合格", "有条件合格"].includes(report.result)) problems.push(`${type}不合格`);
    if (!report.hasAttachment) problems.push(`${type}缺少报告附件`);
    if (report.result === "有条件合格" && !report.conclusion.trim()) problems.push(`${type}缺少处置依据`);
    if (!requirement.trim() || report.requirementRef.trim() !== requirement.trim()) problems.push(`${type}要求与当前设计输出不一致`);
  }
  return problems;
}

export function motorTestIssues(motor: ProjectMotor, reportsNewestFirst: TestReport[], documents: NpdDocument[]) {
  const latest = new Map<string, TestReport>();
  for (const report of reportsNewestFirst) {
    if (report.motorId === motor.id && report.projectId === motor.projectId && report.requirementRevision === motor.designRevision && !latest.has(report.reportType)) {
      latest.set(report.reportType, report);
    }
  }
  return testEvidenceIssues(motor.testRequirement, [...latest.values()].map((report) => ({
    type: report.reportType, result: report.result, conclusion: report.conclusion, requirementRef: report.requirementRef,
    hasAttachment: documents.some((document) => document.id === report.documentId && document.projectId === motor.projectId && document.sheetCode === "verification"),
  })));
}

export function inspectionEvidenceIssues(requirement: string, record?: {
  result: string; hasAttachment: boolean; conclusion: string; requirement: string;
}): string[] {
  if (!record) return ["当前设计版次尚无检验记录"];
  const problems: string[] = [];
  if (!["合格", "让步接收"].includes(record.result)) problems.push("最新检验结论不合格");
  if (!record.hasAttachment) problems.push("缺少检验附件");
  if (record.result === "让步接收" && !record.conclusion.trim()) problems.push("缺少让步接收依据");
  if (!requirement.trim() || record.requirement.trim() !== requirement.trim()) problems.push("检验要求与当前设计输出不一致");
  return problems;
}

export function targetInspectionEvidence(target: ProjectMotor | PartItem, type: "motor" | "part", recordsNewestFirst: InspectionRecord[], documents: NpdDocument[]) {
  const record = recordsNewestFirst.find((item) => item.projectId === target.projectId && item.itemType === type &&
    item.requirementRevision === target.designRevision && (type === "motor"
      ? item.motorId === target.id && !item.partItemId : item.partItemId === target.id && !item.motorId));
  return { record, issues: inspectionEvidenceIssues(target.inspectionRequirement, record ? {
    result: record.result, conclusion: record.conclusion, requirement: record.inspectionRequirement,
    hasAttachment: documents.some((document) => document.id === record.documentId && document.projectId === target.projectId && document.sheetCode === "quality_inspection"),
  } : undefined) };
}
