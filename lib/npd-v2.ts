export type NpdRole =
  | "admin"
  | "sales"
  | "design"
  | "process"
  | "procurement"
  | "production"
  | "tester"
  | "quality";

export type ProjectStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "cancelled";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type SheetCode =
  | "initiation"
  | "input_output"
  | "development_plan"
  | "design_review"
  | "parts_plan"
  | "verification"
  | "quality_inspection"
  | "customer_trial"
  | "identification"
  | "change_archive";

export type SheetStatus =
  | "not_started"
  | "in_progress"
  | "pending_review"
  | "completed"
  | "blocked";

export interface NpdUser {
  id: string;
  email: string;
  name: string;
  department: string;
  role: NpdRole;
  roleLabel: string;
  active: boolean;
  avatar: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface NpdCustomer {
  id: string;
  code: string;
  name: string;
  industry: string;
  contact: string;
  phone: string;
}

export interface NpdSalesOrder {
  id: string;
  version: number;
  orderNo: string;
  customerId: string;
  customerName: string;
  projectId: string | null;
  projectCode: string;
  productSummary: string;
  quantity: number;
  amount: number;
  currency: string;
  orderDate: string;
  deliveryDate: string;
  status: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  version: number;
  projectId: string;
  userId: string;
  userName: string;
  role: NpdRole;
  roleLabel: string;
  responsibility: string;
  createdAt: string;
}

export interface ProjectMotor {
  id: string;
  projectId: string;
  model: string;
  ratedPower: string;
  voltage: string;
  frequency: string;
  poles: string;
  speed: string;
  frameSize: string;
  mounting: string;
  terminalMode: string;
  protectionGrade: string;
  insulationClass: string;
  coolingMethod: string;
  quantity: number;
  designRevision: number;
  inspectionRequirement: string;
  testRequirement: string;
  plannedDate: string;
  actualDate: string | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  productionNote: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function motorProductionLabel(motor: Pick<ProjectMotor, "status" | "confirmedBy" | "confirmedAt" | "actualDate">) {
  if (motor.status === "completed" && (!motor.confirmedBy || !motor.confirmedAt || !motor.actualDate)) return "历史完工 · 待生产复核";
  return ({ planned: "计划中", in_progress: "生产中", completed: "生产已完成", blocked: "生产受阻" } as Record<string, string>)[motor.status] || motor.status;
}

export function partStatusLabel(status: string) {
  return ({ planned: "计划中", in_progress: "进行中", completed: "已完成", blocked: "受阻" } as Record<string, string>)[status] || status;
}

export function documentKindLabel(kind: string) {
  return ({ test_report: "试验报告", inspection_record: "检验记录", stage_attachment: "阶段附件", attachment: "附件" } as Record<string, string>)[kind] || kind;
}

export interface NpdProject {
  id: string;
  code: string;
  name: string;
  seriesName: string;
  category: string;
  source: string;
  customerId: string;
  customerName: string;
  initiatorId: string;
  initiatorName: string;
  ownerId: string;
  ownerName: string;
  status: ProjectStatus;
  lifecycleVersion: number;
  ownershipVersion: number;
  riskLevel: RiskLevel;
  currentSheetCode: SheetCode;
  currentSheetTitle: string;
  progress: number;
  plannedStart: string;
  plannedEnd: string;
  actualEnd: string | null;
  priority: string;
  description: string;
  motorCount: number;
  overdueDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSheet {
  id: string;
  projectId: string;
  code: SheetCode;
  title: string;
  sortOrder: number;
  ownerRole: NpdRole;
  ownerRoleLabel: string;
  status: SheetStatus;
  progress: number;
  plannedDate: string;
  actualDate: string | null;
  version: number;
  note: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

export interface SheetRevision {
  id: string;
  projectId: string;
  sheetCode: SheetCode;
  version: number;
  action: string;
  summary: string;
  reason: string;
  status: SheetStatus;
  progress: number;
  plannedDate: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}

export interface NpdFormRecord {
  id: string;
  projectId: string;
  formCode: string;
  sheetCode: SheetCode;
  status: "draft" | "submitted";
  version: number;
  payload: Record<string, string | number | boolean>;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

export interface PartItem {
  id: string;
  projectId: string;
  motorId: string | null;
  motorModel: string;
  partNo: string;
  name: string;
  specification: string;
  material: string;
  quantity: number;
  sourceType: string;
  designOutputRef: string;
  inspectionRequirement: string;
  testRequirement: string;
  plannedDate: string;
  actualDate: string | null;
  status: string;
  confirmedBy: string | null;
  confirmedByName: string;
  confirmedAt: string | null;
  designRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TestReport {
  id: string;
  projectId: string;
  motorId: string;
  motorModel: string;
  reportNo: string;
  reportType: string;
  title: string;
  requirementRef: string;
  testDate: string;
  result: string;
  conclusion: string;
  documentId: string | null;
  fileName: string;
  submittedBy: string;
  submittedByName: string;
  requirementRevision: number;
  createdAt: string;
}

export interface InspectionRecord {
  id: string;
  projectId: string;
  motorId: string | null;
  motorModel: string;
  partItemId: string | null;
  itemName: string;
  itemType: "motor" | "part";
  inspectionRequirement: string;
  designOutputRef: string;
  inspectionDate: string;
  result: string;
  conclusion: string;
  documentId: string | null;
  fileName: string;
  inspectorId: string;
  inspectorName: string;
  requirementRevision: number;
  createdAt: string;
}

export interface NpdDocument {
  id: string;
  projectId: string;
  sheetCode: SheetCode;
  motorId: string | null;
  linkedRecordId: string | null;
  kind: string;
  fileName: string;
  objectKey: string;
  contentType: string;
  size: number;
  version: string;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
}

export interface NpdActivity {
  id: string;
  projectId: string | null;
  projectCode: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: string;
  createdAt: string;
}

export interface DashboardPreference {
  periodMode: "year" | "half" | "month" | "custom";
  periodValue: string;
  customStart: string;
  customEnd: string;
  visibleMetrics: string[];
}

export interface NpdWorkspaceSnapshot {
  projects: NpdProject[];
  customers: NpdCustomer[];
  orders: NpdSalesOrder[];
  users: NpdUser[];
  members: ProjectMember[];
  motors: ProjectMotor[];
  sheets: ProjectSheet[];
  sheetRevisions: SheetRevision[];
  formRecords: NpdFormRecord[];
  parts: PartItem[];
  testReports: TestReport[];
  inspections: InspectionRecord[];
  documents: NpdDocument[];
  activities: NpdActivity[];
  dashboardPreference: DashboardPreference;
}

export const roleLabels: Record<NpdRole, string> = {
  admin: "管理员",
  sales: "销售",
  design: "设计",
  process: "工艺",
  procurement: "采购",
  production: "生产",
  tester: "试验员",
  quality: "质量",
};

export const sheetStatusLabels: Record<SheetStatus, string> = {
  not_started: "未开始",
  in_progress: "进行中",
  pending_review: "待确认",
  completed: "已完成",
  blocked: "受阻",
};

export const projectStatusLabels: Record<ProjectStatus, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已终止",
};
