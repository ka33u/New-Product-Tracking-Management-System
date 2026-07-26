export type RoleKey =
  | "system_admin"
  | "management"
  | "technical_director"
  | "project_manager"
  | "designer"
  | "process"
  | "quality"
  | "manufacturing"
  | "procurement"
  | "sales"
  | "finance"
  | "viewer";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ProjectStatus =
  | "planning"
  | "active"
  | "paused"
  | "completed"
  | "cancelled";
export type GateStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "completed"
  | "waived";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  department: string;
  role: RoleKey;
  roleLabel: string;
  avatar: string;
}

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  department: string;
  role: RoleKey;
  roleLabel: string;
  active: boolean;
  currentLoad: number;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  industry: string;
  contact: string;
  phone: string;
  tier: string;
  activeProjects: number;
}

export interface SalesOrder {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  productModel: string;
  quantity: number;
  amount: number;
  currency: string;
  deliveryDate: string;
  status: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  productModel: string;
  motorCode: string;
  category: string;
  source: string;
  customerId: string;
  customerName: string;
  orderId: string | null;
  orderNo: string | null;
  ownerId: string;
  ownerName: string;
  trackerName: string;
  stage: string;
  stageLabel: string;
  status: ProjectStatus;
  progress: number;
  riskLevel: RiskLevel;
  plannedStart: string;
  plannedEnd: string;
  actualEnd: string | null;
  budget: number;
  spent: number;
  targetCost: number;
  priority: string;
  description: string;
  nextMilestone: string;
  nextMilestoneDate: string;
  overdueDays: number;
  formCompletion: number;
  issueCount: number;
}

export interface Milestone {
  id: string;
  projectId: string;
  gateCode: string;
  name: string;
  department: string;
  ownerName: string;
  plannedDate: string;
  actualDate: string | null;
  status: GateStatus;
  progress: number;
  requiredForm: string;
  evidenceCount: number;
  note: string;
}

export interface Approval {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  title: string;
  formCode: string;
  formName: string;
  submitterName: string;
  approverRole: RoleKey;
  approverLabel: string;
  status: ApprovalStatus;
  submittedAt: string;
  dueAt: string;
  decisionAt: string | null;
  comment: string;
}

export interface Issue {
  id: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  title: string;
  category: string;
  severity: RiskLevel;
  ownerName: string;
  status: string;
  dueDate: string;
  createdAt: string;
  resolution: string;
}

export interface ChangeRequest {
  id: string;
  changeNo: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  changeType: string;
  title: string;
  reason: string;
  initiatorName: string;
  affectedObject: string;
  supplierNotice: boolean;
  customerNotice: boolean;
  disposition: string;
  status: string;
  createdAt: string;
  dueDate: string;
}

export interface Activity {
  id: string;
  projectId: string | null;
  projectCode: string | null;
  actorName: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface DocumentRecord {
  id: string;
  projectId: string;
  formCode: string;
  fileName: string;
  objectKey: string;
  contentType: string;
  size: number;
  version: string;
  uploadedBy: string;
  createdAt: string;
}

export interface FormRecord {
  id: string;
  projectId: string;
  formCode: string;
  status: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
  payload: Record<string, string | number | boolean>;
}

export interface WorkspaceSnapshot {
  projects: Project[];
  customers: Customer[];
  orders: SalesOrder[];
  milestones: Milestone[];
  approvals: Approval[];
  issues: Issue[];
  changes: ChangeRequest[];
  activities: Activity[];
  users: UserRecord[];
  documents: DocumentRecord[];
  formRecords: FormRecord[];
  metrics: {
    activeProjects: number;
    onTimeRate: number;
    overdueMilestones: number;
    pendingApprovals: number;
    highRiskProjects: number;
    orderCoverage: number;
    completedThisQuarter: number;
    averageCycleDays: number;
  };
}
