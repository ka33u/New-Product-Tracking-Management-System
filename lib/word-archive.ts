import type { ProjectArchiveData } from "./export-v2";
import type { SheetCode } from "./npd-v2";
import { motorProductionLabel, projectStatusLabels, sheetStatusLabels } from "./npd-v2";
import { formDefinitions } from "./forms";
import { sheetByCode, sheetDefinitions } from "./sheets-v2";
import { packWordArchive, wordFields, wordHeading, wordParagraph, wordTable, type WordBlock } from "./docx-runtime";

const statusLabels: Record<string, string> = { ...sheetStatusLabels, ...projectStatusLabels,
  pending: "待处理", planned: "已计划", confirmed: "已确认", delivered: "已交付", delayed: "已延期", in_development: "开发中" };
const priorityLabels: Record<string, string> = { low: "低", normal: "普通", high: "高", urgent: "紧急" };
const riskLabels: Record<string, string> = { low: "低", medium: "中", high: "高", critical: "严重" };

export function archiveTimestamp(value: string | null | undefined) {
  if (!value) return "未记录";
  const date = new Date(/^[\d-]+ \d\d:\d\d:\d\d$/.test(value) ? value.replace(" ", "T") + "Z" : value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
}

export async function buildProjectWord(data: ProjectArchiveData, onlySheet?: SheetCode, author = "亨达新品开发") {
  const project = data.project;
  const title = onlySheet ? `${sheetByCode[onlySheet].shortTitle} 归档记录` : "完整开发程序档案";
  const blocks: WordBlock[] = [wordParagraph(project.name), ...wordFields([
    ["项目编号", project.code], ["产品系列", project.seriesName], ["客户", project.customerName],
    ["发起人", project.initiatorName], ["项目负责人", project.ownerName],
    ["项目状态", `${projectStatusLabels[project.status]}  总体进度 ${project.progress}%`],
    ["计划周期", `${project.plannedStart} 至 ${project.plannedEnd}`], ["实际完成", project.actualEnd],
    ["导出人", author], ["归档时间", `${archiveTimestamp(new Date().toISOString())} 北京时间`],
  ]), wordParagraph("本档案用于项目复核、交接和归档。未填写、草稿及未完成阶段不代表已获得批准；签章和试验检验证据以对应受控记录及附件为准。"),
  wordParagraph("本文保存当前记录与版本变更摘要，不内嵌附件原件；请与附件及项目完整Excel一并保存，历史数据快照可在Excel中查阅。", { small: true })];
  if (!onlySheet) {
    blocks.push(wordHeading("项目阶段目录", 1, true), ...wordTable(["序号", "开发阶段", "状态", "版次"], sheetDefinitions.map((definition) => {
      const stage = data.sheets.find((item) => item.code === definition.code);
      return [definition.index, definition.title, stage ? sheetStatusLabels[stage.status] : "未开始", stage ? `V${stage.version}` : "未建立"];
    }), [1, 5, 2, 1], [0, 2, 3]));
    blocks.push(wordHeading("项目背景与成员", 1, true), ...wordFields([
      ["产品类别", project.category], ["项目来源", project.source], ["优先级", priorityLabels[project.priority] || project.priority], ["风险等级", riskLabels[project.riskLevel] || project.riskLevel],
      ["项目说明", project.description], ["创建时间", archiveTimestamp(project.createdAt)], ["最后更新", archiveTimestamp(project.updatedAt)],
    ]), ...wordTable(["姓名", "角色", "职责", "加入时间"], data.members.map((item) => [item.userName, item.roleLabel, item.responsibility, archiveTimestamp(item.createdAt)]), [2, 2, 5, 3]));
  }
  if (!onlySheet || onlySheet === "input_output") {
    blocks.push(wordHeading("电机规格及设计输出", 1, !onlySheet));
    if (!data.motors.length) blocks.push(wordParagraph("暂无电机规格"));
    data.motors.forEach((motor, index) => blocks.push(wordHeading(`规格 ${index + 1} ${motor.model}`, 2, index > 0), ...wordFields([
      ["设计版次", `R${motor.designRevision}`], ["额定功率", motor.ratedPower], ["电压和频率", `${motor.voltage}  ${motor.frequency}`],
      ["极数和转速", `${motor.poles}  ${motor.speed}`], ["机座号", motor.frameSize], ["安装方式", motor.mounting],
      ["出线形式", motor.terminalMode], ["防护等级", motor.protectionGrade], ["绝缘等级", motor.insulationClass], ["冷却方式", motor.coolingMethod],
      ["数量", motor.quantity], ["检验要求", motor.inspectionRequirement], ["试验要求", motor.testRequirement],
      ["计划完成", motor.plannedDate], ["实际完成", motor.actualDate], ["规格状态", motorProductionLabel(motor)], ["最后更新", archiveTimestamp(motor.updatedAt)],
    ])));
  }
  for (const definition of onlySheet ? [sheetByCode[onlySheet]] : sheetDefinitions) {
    const stage = data.sheets.find((item) => item.code === definition.code);
    blocks.push(wordHeading(`${definition.index} ${definition.title}`, 1, true), wordParagraph(definition.subtitle), ...wordFields([
      ["责任角色", stage?.ownerRoleLabel], ["当前状态", stage ? sheetStatusLabels[stage.status] : "未开始"],
      ["阶段版本", stage ? `V${stage.version}` : "未建立"], ["阶段进度", `${stage?.progress || 0}%`],
      ["计划完成", stage?.plannedDate], ["实际完成", stage?.actualDate], ["最后维护人", stage?.updatedByName],
      ["最后更新", archiveTimestamp(stage?.updatedAt)], ["阶段备注", stage?.note],
    ]));
    for (const code of definition.formCodes) {
      const form = formDefinitions.find((item) => item.code === code);
      const record = data.forms.find((item) => item.formCode === code);
      blocks.push(wordHeading(form?.name || code, 2), wordParagraph(`表单编号 ${code}`, { small: true }),
        wordParagraph(`状态 ${record?.status === "submitted" ? "已提交" : record ? "草稿" : "未填写"}  版本 V${record?.version || 0}  维护人 ${record?.updatedByName || "未记录"}  ${archiveTimestamp(record?.updatedAt)}`, { small: true }),
        ...wordFields((form?.fields || []).map((field) => [field.label, record?.payload[field.key]])));
      const known = new Set((form?.fields || []).map((field) => field.key));
      const extra = Object.entries(record?.payload || {}).filter(([key]) => !known.has(key));
      if (extra.length) blocks.push(wordHeading("历史扩展字段", 2), ...wordFields(extra));
    }
    if (definition.code === "parts_plan") {
      blocks.push(wordHeading("整机生产节点", 2));
      for (const motor of data.motors) blocks.push(wordHeading(motor.model, 2), ...wordFields([
        ["设计版次", `R${motor.designRevision}`], ["数量", motor.quantity], ["计划完成", motor.plannedDate], ["实际完成", motor.actualDate],
        ["生产状态", motorProductionLabel(motor)], ["生产确认人", motor.confirmedByName],
        ["生产确认时间", archiveTimestamp(motor.confirmedAt)], ["生产确认说明", motor.productionNote],
      ]));
      blocks.push(wordHeading("零部件节点明细", 2));
      if (!data.parts.length) blocks.push(wordParagraph("暂无零部件记录"));
      for (const part of data.parts) blocks.push(wordHeading(`${part.partNo} ${part.name}`, 2), ...wordFields([
        ["关联规格", part.motorModel || "系列通用"], ["设计版次", `R${part.designRevision}`], ["规格", part.specification], ["材质", part.material],
        ["数量", part.quantity], ["来源", part.sourceType], ["设计输出引用", part.designOutputRef], ["检验要求", part.inspectionRequirement], ["试验要求", part.testRequirement],
        ["计划完成", part.plannedDate], ["实际完成", part.actualDate], ["状态", statusLabels[part.status] || part.status], ["生产确认人", part.confirmedByName], ["生产确认时间", archiveTimestamp(part.confirmedAt)],
      ]));
    }
    if (definition.code === "verification") {
      blocks.push(wordHeading("规格试验报告", 2));
      if (!data.tests.length) blocks.push(wordParagraph("暂无试验报告"));
      for (const report of data.tests) blocks.push(wordHeading(`${report.reportNo} ${report.title}`, 2), ...wordFields([
        ["电机规格", report.motorModel], ["关联设计版次", `R${report.requirementRevision}`], ["报告类型", report.reportType], ["试验要求", report.requirementRef],
        ["试验日期", report.testDate], ["试验结果", report.result], ["结论与处置依据", report.conclusion], ["附件文件", report.fileName],
        ["提交人", report.submittedByName], ["提交时间", archiveTimestamp(report.createdAt)],
      ]));
    }
    if (definition.code === "quality_inspection") {
      blocks.push(wordHeading("质量检验明细", 2));
      if (!data.inspections.length) blocks.push(wordParagraph("暂无检验记录"));
      for (const record of data.inspections) blocks.push(wordHeading(record.itemName, 2), ...wordFields([
        ["检验对象类型", record.itemType === "motor" ? "整机" : "零部件"], ["关联设计版次", `R${record.requirementRevision}`],
        ["设计输出中的检验要求", record.inspectionRequirement], ["设计输出引用", record.designOutputRef], ["检验日期", record.inspectionDate],
        ["检验结果", record.result], ["结论与处置依据", record.conclusion], ["附件文件", record.fileName],
        ["检验员", record.inspectorName], ["记录时间", archiveTimestamp(record.createdAt)],
      ]));
    }
    blocks.push(wordHeading("版本与修改记录", 2));
    const revisions = data.revisions.filter((item) => item.sheetCode === definition.code);
    if (!revisions.length) blocks.push(wordParagraph("暂无版本记录"));
    for (const revision of revisions) blocks.push(wordParagraph(`V${revision.version}  ${revision.action}  ${revision.actorName}  ${archiveTimestamp(revision.createdAt)}`, { keepNext: true }), ...wordFields([
      ["变更摘要", revision.summary], ["修改原因", revision.reason], ["当时状态与进度", `${sheetStatusLabels[revision.status]}  ${revision.progress}%`], ["当时计划节点", revision.plannedDate],
    ]));
    const documents = data.documents.filter((item) => item.sheetCode === definition.code);
    if (documents.length) blocks.push(wordHeading("附件索引", 2), ...wordTable(["文件名", "类别与版本", "上传人", "上传时间"], documents
      .map((item) => [item.fileName, `${item.kind}  ${item.version}`, item.uploadedByName, archiveTimestamp(item.createdAt)]), [5, 3, 2, 3]));
    else blocks.push(wordParagraph("附件索引：暂无记录", { small: true }));
  }
  if (!onlySheet) {
    blocks.push(wordHeading("关联销售订单", 1, true));
    if (!data.orders.length) blocks.push(wordParagraph("无关联订单"));
    for (const order of data.orders) blocks.push(wordHeading(order.orderNo, 2), ...wordFields([
      ["客户", order.customerName], ["产品概要", order.productSummary], ["数量", order.quantity], ["金额与币种", `${order.amount} ${order.currency}`],
      ["订单日期", order.orderDate], ["交付日期", order.deliveryDate], ["订单状态", statusLabels[order.status] || order.status], ["录入人", order.createdByName], ["最后更新", archiveTimestamp(order.updatedAt)],
    ]));
    blocks.push(wordHeading("项目操作日志", 1));
    if (!data.activities.length) blocks.push(wordParagraph("暂无操作日志"));
    for (const item of data.activities) blocks.push(wordParagraph(`${archiveTimestamp(item.createdAt)}  ${item.actorName}  ${item.action}`, { keepNext: true }), wordParagraph(item.detail));
  }
  return packWordArchive(title, project.code, blocks, author);
}
