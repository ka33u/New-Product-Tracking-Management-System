import { formDefinitions } from "./forms";
import type {
  InspectionRecord,
  NpdActivity,
  NpdCustomer,
  NpdDocument,
  NpdFormRecord,
  NpdProject,
  NpdSalesOrder,
  NpdUser,
  NpdWorkspaceSnapshot,
  PartItem,
  ProjectMember,
  ProjectMotor,
  ProjectSheet,
  SheetCode,
  TestReport,
} from "./npd-v2";
import { projectStatusLabels, roleLabels, sheetStatusLabels } from "./npd-v2";
import { sheetByCode, sheetDefinitions } from "./sheets-v2";

export interface ProjectArchiveData {
  project: NpdProject;
  customer: NpdCustomer | null;
  orders: NpdSalesOrder[];
  members: ProjectMember[];
  motors: ProjectMotor[];
  sheets: ProjectSheet[];
  forms: NpdFormRecord[];
  parts: PartItem[];
  tests: TestReport[];
  inspections: InspectionRecord[];
  documents: NpdDocument[];
  activities: NpdActivity[];
}

type Cell = string | number | boolean | null | undefined;

const xmlEscape = (value: Cell) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

const htmlEscape = (value: Cell) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const displayValue = (value: unknown) => {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value == null) return "";
  return String(value);
};

function worksheet(name: string, rows: Cell[][]) {
  const safeName = name.replace(/[\\/?*\[\]:]/g, "-").slice(0, 31);
  return `<Worksheet ss:Name="${xmlEscape(safeName)}"><Table>${rows.map((row, rowIndex) =>
    `<Row>${row.map((cell) => {
      const isNumber = typeof cell === "number" && Number.isFinite(cell);
      return `<Cell${rowIndex === 0 ? ' ss:StyleID="Header"' : ""}><Data ss:Type="${isNumber ? "Number" : "String"}">${xmlEscape(cell)}</Data></Cell>`;
    }).join("")}</Row>`,
  ).join("")}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions></Worksheet>`;
}

function workbook(worksheets: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Author>亨达新品开发</Author><Created>${new Date().toISOString()}</Created></DocumentProperties>
<Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center" ss:WrapText="1"/><Font ss:FontName="Microsoft YaHei" ss:Size="10"/><Borders/><Interior/><NumberFormat/><Protection/></Style><Style ss:ID="Header"><Font ss:FontName="Microsoft YaHei" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#163A5F" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style></Styles>
${worksheets.join("\n")}</Workbook>`;
}

function formRows(data: ProjectArchiveData) {
  const rows: Cell[][] = [["阶段 Sheet", "表单编号", "表单名称", "字段", "内容", "状态", "版本", "最后维护人", "最后更新时间"]];
  for (const sheet of sheetDefinitions) {
    for (const formCode of sheet.formCodes) {
      const definition = formDefinitions.find((form) => form.code === formCode);
      const record = data.forms.find((form) => form.formCode === formCode);
      const fields = definition?.fields || [];
      if (!fields.length) {
        rows.push([sheet.shortTitle, formCode, definition?.name || formCode, "", "", record?.status || "未填写", record?.version || 0, record?.updatedByName || "", record?.updatedAt || ""]);
        continue;
      }
      for (const field of fields) {
        rows.push([
          sheet.shortTitle,
          formCode,
          definition?.name || formCode,
          field.label,
          displayValue(record?.payload[field.key]),
          record?.status === "submitted" ? "已提交" : record ? "草稿" : "未填写",
          record?.version || 0,
          record?.updatedByName || "",
          record?.updatedAt || "",
        ]);
      }
    }
  }
  return rows;
}

export function buildProjectExcel(data: ProjectArchiveData) {
  const { project } = data;
  const sheets = [
    worksheet("项目概览", [
      ["项目编号", "项目名称", "系列", "客户", "发起人", "项目负责人", "状态", "风险", "进度", "规格数", "计划开始", "计划完成", "实际完成", "最后更新"],
      [project.code, project.name, project.seriesName, project.customerName, project.initiatorName, project.ownerName, projectStatusLabels[project.status], project.riskLevel, `${project.progress}%`, project.motorCount, project.plannedStart, project.plannedEnd, project.actualEnd, project.updatedAt],
    ]),
    worksheet("电机规格", [
      ["型号规格", "电机编码", "功率", "电压", "频率", "极数", "转速", "机座号", "安装方式", "数量", "检验要求", "试验要求", "计划节点", "实际完成", "状态", "更新时间"],
      ...data.motors.map((motor) => [motor.model, motor.motorCode, motor.ratedPower, motor.voltage, motor.frequency, motor.poles, motor.speed, motor.frameSize, motor.mounting, motor.quantity, motor.inspectionRequirement, motor.testRequirement, motor.plannedDate, motor.actualDate, motor.status, motor.updatedAt]),
    ]),
    worksheet("关联销售订单", [
      ["订单号", "客户", "产品概要", "数量", "金额", "币种", "订单日期", "交付日期", "状态", "录入人", "更新时间"],
      ...data.orders.map((order) => [order.orderNo, order.customerName, order.productSummary, order.quantity, order.amount, order.currency, order.orderDate, order.deliveryDate, order.status, order.createdByName, order.updatedAt]),
    ]),
    worksheet("阶段Sheet", [
      ["序号", "阶段", "责任角色", "状态", "进度", "计划日期", "实际日期", "版本", "备注", "最后维护人", "更新时间"],
      ...data.sheets.map((sheet) => [sheet.sortOrder, sheet.title, sheet.ownerRoleLabel, sheetStatusLabels[sheet.status], `${sheet.progress}%`, sheet.plannedDate, sheet.actualDate, `V${sheet.version}`, sheet.note, sheet.updatedByName, sheet.updatedAt]),
    ]),
    worksheet("受控表单明细", formRows(data)),
    worksheet("零部件节点", [
      ["关联规格", "零部件编号", "名称", "规格", "材质", "数量", "来源", "设计输出引用", "检验要求", "试验要求", "计划完成", "实际完成", "状态", "生产确认人", "确认时间"],
      ...data.parts.map((part) => [part.motorModel || "通用", part.partNo, part.name, part.specification, part.material, part.quantity, part.sourceType, part.designOutputRef, part.inspectionRequirement, part.testRequirement, part.plannedDate, part.actualDate, part.status, part.confirmedByName, part.confirmedAt]),
    ]),
    worksheet("试验报告", [
      ["电机规格", "报告编号", "报告类型", "报告名称", "要求引用", "试验日期", "结果", "结论", "附件", "提交人", "提交时间"],
      ...data.tests.map((report) => [report.motorModel, report.reportNo, report.reportType, report.title, report.requirementRef, report.testDate, report.result, report.conclusion, report.fileName, report.submittedByName, report.createdAt]),
    ]),
    worksheet("质量检验", [
      ["检验对象", "对象类型", "检验要求（设计输出）", "设计输出引用", "检验日期", "结果", "结论", "附件", "检验员", "记录时间"],
      ...data.inspections.map((record) => [record.itemName, record.itemType === "motor" ? "整机" : "零部件", record.inspectionRequirement, record.designOutputRef, record.inspectionDate, record.result, record.conclusion, record.fileName, record.inspectorName, record.createdAt]),
    ]),
    worksheet("项目成员", [
      ["姓名", "角色", "职责", "加入时间"],
      ...data.members.map((member) => [member.userName, member.roleLabel, member.responsibility, member.createdAt]),
    ]),
    worksheet("附件索引", [
      ["Sheet", "附件类型", "文件名", "版本", "上传人", "上传时间"],
      ...data.documents.map((document) => [sheetByCode[document.sheetCode].shortTitle, document.kind, document.fileName, document.version, document.uploadedByName, document.createdAt]),
    ]),
    worksheet("操作日志", [
      ["时间戳", "操作人", "操作", "对象类型", "详细内容"],
      ...data.activities.map((activity) => [activity.createdAt, activity.actorName, activity.action, activity.entityType, activity.detail]),
    ]),
  ];
  return workbook(sheets);
}

export function buildPortfolioExcel(snapshot: NpdWorkspaceSnapshot, currentUser: NpdUser) {
  return workbook([
    worksheet("项目总览", [
      ["项目编号", "项目名称", "系列", "客户", "发起人", "负责人", "当前阶段", "状态", "风险", "进度", "规格数", "计划开始", "计划完成", "逾期天数", "最后更新"],
      ...snapshot.projects.map((project) => [project.code, project.name, project.seriesName, project.customerName, project.initiatorName, project.ownerName, project.currentSheetTitle, projectStatusLabels[project.status], project.riskLevel, `${project.progress}%`, project.motorCount, project.plannedStart, project.plannedEnd, project.overdueDays, project.updatedAt]),
    ]),
    worksheet("阶段进度", [
      ["项目编号", "项目名称", "阶段", "责任角色", "状态", "进度", "计划日期", "更新时间"],
      ...snapshot.sheets.map((sheet) => {
        const project = snapshot.projects.find((row) => row.id === sheet.projectId);
        return [project?.code || "", project?.name || "", sheet.title, sheet.ownerRoleLabel, sheetStatusLabels[sheet.status], `${sheet.progress}%`, sheet.plannedDate, sheet.updatedAt];
      }),
    ]),
    worksheet("销售订单", [
      ["订单号", "客户", "产品概要", "数量", "金额", "币种", "订单日期", "交付日期", "关联项目", "状态"],
      ...snapshot.orders.map((order) => [order.orderNo, order.customerName, order.productSummary, order.quantity, order.amount, order.currency, order.orderDate, order.deliveryDate, order.projectCode || "未关联", order.status]),
    ]),
    worksheet("导出说明", [
      ["导出人", "角色", "导出时间", "数据范围"],
      [currentUser.name, roleLabels[currentUser.role], new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }), currentUser.role === "admin" ? "全部项目" : "本人发起、负责或参与的项目"],
    ]),
  ]);
}

const htmlTable = (headers: string[], rows: Cell[][]) => `<table><thead><tr>${headers.map((header) => `<th>${htmlEscape(header)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}" class="empty">暂无记录</td></tr>`}</tbody></table>`;

function archiveSection(data: ProjectArchiveData, sheetCode: SheetCode) {
  const definition = sheetByCode[sheetCode];
  const stage = data.sheets.find((sheet) => sheet.code === sheetCode);
  const forms = definition.formCodes.map((formCode) => {
    const form = formDefinitions.find((item) => item.code === formCode);
    const record = data.forms.find((item) => item.formCode === formCode);
    return `<h3>${htmlEscape(form?.name || formCode)} <small>${htmlEscape(formCode)}</small></h3>${htmlTable(["字段", "内容"], (form?.fields || []).map((field) => [field.label, displayValue(record?.payload[field.key])]))}<p class="meta">状态：${record?.status === "submitted" ? "已提交" : record ? "草稿" : "未填写"}　版本：V${record?.version || 0}　最后维护：${htmlEscape(record?.updatedByName || "—")} ${htmlEscape(record?.updatedAt || "")}</p>`;
  }).join("");
  let special = "";
  if (sheetCode === "parts_plan") special = htmlTable(["关联规格", "零部件编号", "名称", "规格/材质", "设计输出引用", "检验要求", "试验要求", "计划节点", "状态", "生产确认"], data.parts.map((part) => [part.motorModel || "通用", part.partNo, part.name, `${part.specification} / ${part.material}`, part.designOutputRef, part.inspectionRequirement, part.testRequirement, part.plannedDate, part.status, `${part.confirmedByName} ${part.confirmedAt || ""}`]));
  if (sheetCode === "verification") special = htmlTable(["规格", "报告编号", "类型", "试验要求", "日期", "结果", "结论", "附件", "提交人/时间"], data.tests.map((item) => [item.motorModel, item.reportNo, item.reportType, item.requirementRef, item.testDate, item.result, item.conclusion, item.fileName, `${item.submittedByName} ${item.createdAt}`]));
  if (sheetCode === "quality_inspection") special = htmlTable(["对象", "类型", "设计输出检验要求", "输出引用", "检验日期", "结果", "结论", "附件", "检验员/时间"], data.inspections.map((item) => [item.itemName, item.itemType === "motor" ? "整机" : "零部件", item.inspectionRequirement, item.designOutputRef, item.inspectionDate, item.result, item.conclusion, item.fileName, `${item.inspectorName} ${item.createdAt}`]));
  const docs = data.documents.filter((document) => document.sheetCode === sheetCode);
  return `<section><h2>${definition.index}. ${htmlEscape(definition.title)}</h2><p class="meta">责任角色：${htmlEscape(stage?.ownerRoleLabel || roleLabels[definition.ownerRole])}　状态：${htmlEscape(stage ? sheetStatusLabels[stage.status] : "未开始")}　进度：${stage?.progress || 0}%　计划节点：${htmlEscape(stage?.plannedDate || "—")}　版本：V${stage?.version || 1}　最后更新时间：${htmlEscape(stage?.updatedAt || "—")}</p><p>${htmlEscape(definition.subtitle)}</p>${forms}${special}<h3>附件索引</h3>${htmlTable(["文件名", "类别", "版本", "上传人", "时间戳"], docs.map((doc) => [doc.fileName, doc.kind, doc.version, doc.uploadedByName, doc.createdAt]))}</section>`;
}

export function buildProjectArchiveHtml(data: ProjectArchiveData, onlySheet?: SheetCode) {
  const title = onlySheet ? `${data.project.code}-${sheetByCode[onlySheet].shortTitle}` : `${data.project.code}-完整开发程序档案`;
  const sections = onlySheet ? archiveSection(data, onlySheet) : sheetDefinitions.map((sheet) => archiveSection(data, sheet.code)).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title><style>@page{size:A4;margin:18mm}body{font-family:"Microsoft YaHei",Arial,sans-serif;color:#172033;font-size:10.5pt;line-height:1.6}h1{text-align:center;color:#163a5f;font-size:22pt;border-bottom:3px solid #163a5f;padding-bottom:12px}h2{color:#163a5f;font-size:16pt;border-left:5px solid #d29b3d;padding-left:10px;margin-top:30px;page-break-after:avoid}h3{font-size:12pt;margin:18px 0 8px;page-break-after:avoid}small,.meta{color:#667085;font-size:9pt}table{border-collapse:collapse;width:100%;margin:8px 0 16px;page-break-inside:auto}tr{page-break-inside:avoid}th,td{border:1px solid #aab4c2;padding:6px 7px;text-align:left;vertical-align:top;word-break:break-all}th{background:#e9f0f6;color:#163a5f}.cover{padding:35mm 10mm;text-align:center}.cover h1{font-size:28pt}.cover p{font-size:12pt}.stamp{margin-top:60px;color:#667085}.empty{text-align:center;color:#98a2b3}section{page-break-before:always}</style></head><body><div class="cover"><h1>${htmlEscape(title)}</h1><p>${htmlEscape(data.project.name)} / ${htmlEscape(data.project.seriesName)}</p><p>客户：${htmlEscape(data.project.customerName)}　发起人：${htmlEscape(data.project.initiatorName)}　负责人：${htmlEscape(data.project.ownerName)}</p><p>关联订单：${htmlEscape(data.orders.map((order) => order.orderNo).join("、") || "无")}</p><p>项目状态：${htmlEscape(projectStatusLabels[data.project.status])}　总体进度：${data.project.progress}%　规格数量：${data.project.motorCount}</p><p>计划周期：${htmlEscape(data.project.plannedStart)} 至 ${htmlEscape(data.project.plannedEnd)}</p><p class="stamp">系统归档时间：${htmlEscape(new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }))}</p></div>${sections}${onlySheet ? "" : `<section><h2>关联销售订单</h2>${htmlTable(["订单号", "产品概要", "数量", "金额", "订单日期", "交付日期", "状态"], data.orders.map((order) => [order.orderNo, order.productSummary, order.quantity, `${order.currency} ${order.amount}`, order.orderDate, order.deliveryDate, order.status]))}<h2>项目操作时间戳</h2>${htmlTable(["时间", "操作人", "动作", "对象", "详情"], data.activities.map((item) => [item.createdAt, item.actorName, item.action, item.entityType, item.detail]))}</section>`}</body></html>`;
}

export function safeExportName(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-").slice(0, 80);
}
