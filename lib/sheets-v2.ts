import type { NpdRole, SheetCode } from "./npd-v2";

export interface SheetDefinition {
  code: SheetCode;
  index: number;
  title: string;
  shortTitle: string;
  subtitle: string;
  ownerRole: NpdRole;
  formCodes: string[];
  color: string;
}

export const sheetDefinitions: SheetDefinition[] = [
  {
    code: "initiation",
    index: 1,
    title: "新产品开发立项申请",
    shortTitle: "立项申请",
    subtitle: "记录市场来源、客户需求、商业与技术可行性，形成正式立项结论。",
    ownerRole: "sales",
    formCodes: ["HD/JL-SJ-01A1"],
    color: "#2563eb",
  },
  {
    code: "input_output",
    index: 2,
    title: "设计开发输入与输出",
    shortTitle: "输入输出",
    subtitle: "汇总任务书、法规标准、设计输入、设计输出、检验要求和试验要求。",
    ownerRole: "design",
    formCodes: ["HD/JL-SJ-02A1", "HD/JL-SJ-04A1"],
    color: "#4f46e5",
  },
  {
    code: "development_plan",
    index: 3,
    title: "项目设计开发计划",
    shortTitle: "开发计划",
    subtitle: "明确阶段任务、部门接口、人员职责、资源、预算以及计划完成日期。",
    ownerRole: "design",
    formCodes: ["HD/JL-SJ-03A1", "HD/JL-SJ-10A1"],
    color: "#7c3aed",
  },
  {
    code: "design_review",
    index: 4,
    title: "设计开发评审",
    shortTitle: "开发评审",
    subtitle: "记录跨部门评审意见、问题项、纠正措施、责任人与关闭结论。",
    ownerRole: "design",
    formCodes: ["HD/JL-SJ-05A1"],
    color: "#a855f7",
  },
  {
    code: "parts_plan",
    index: 5,
    title: "零部件明细与完成节点",
    shortTitle: "零部件节点",
    subtitle: "按电机规格管理零部件、图号、材质、来源、设计输出引用和生产确认节点。",
    ownerRole: "production",
    formCodes: [],
    color: "#d97706",
  },
  {
    code: "verification",
    index: 6,
    title: "设计开发验证与试验报告",
    shortTitle: "开发验证",
    subtitle: "关联每个具体规格的型式试验、性能报告、设计要求和验证结论。",
    ownerRole: "tester",
    formCodes: ["HD/JL-SJ-06A1"],
    color: "#ea580c",
  },
  {
    code: "quality_inspection",
    index: 7,
    title: "零部件与整机质量检验",
    shortTitle: "质量检验",
    subtitle: "质量人员依据设计输出中的检验要求，上传零部件与整机检验记录。",
    ownerRole: "quality",
    formCodes: [],
    color: "#059669",
  },
  {
    code: "customer_trial",
    index: 8,
    title: "客户试用与设计确认",
    shortTitle: "客户试用",
    subtitle: "记录客户试用工况、运行结果、反馈问题和设计确认结论。",
    ownerRole: "sales",
    formCodes: ["HD/JL-SJ-07A1"],
    color: "#0d9488",
  },
  {
    code: "identification",
    index: 9,
    title: "新产品鉴定与定型",
    shortTitle: "新品鉴定",
    subtitle: "汇总样机、试验、质量、客户确认结果，形成鉴定、定型和批产结论。",
    ownerRole: "design",
    formCodes: ["HD/JL-SJ-08A1"],
    color: "#0891b2",
  },
  {
    code: "change_archive",
    index: 10,
    title: "文件图纸变更与完整归档",
    shortTitle: "变更归档",
    subtitle: "保存文件图纸变更、版本、通知、实施验证和最终开发程序归档。",
    ownerRole: "design",
    formCodes: ["HD/JL-SJ-09A1"],
    color: "#475569",
  },
];

export const sheetByCode = Object.fromEntries(
  sheetDefinitions.map((sheet) => [sheet.code, sheet]),
) as Record<SheetCode, SheetDefinition>;

export const formToSheet = Object.fromEntries(
  sheetDefinitions.flatMap((sheet) =>
    sheet.formCodes.map((formCode) => [formCode, sheet.code]),
  ),
) as Record<string, SheetCode>;

export const sheetScheduleRatios = [0.04, 0.12, 0.22, 0.34, 0.55, 0.7, 0.8, 0.9, 0.97, 1];
