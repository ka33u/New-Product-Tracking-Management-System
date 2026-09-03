import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  department: text("department").notNull(),
  role: text("role").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  currentLoad: integer("current_load").notNull().default(0),
  bootstrapAdmin: integer("bootstrap_admin", { mode: "boolean" })
    .notNull()
    .default(false),
  ...timestamps,
});

export const customers = sqliteTable("customers", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  contact: text("contact").notNull().default(""),
  phone: text("phone").notNull().default(""),
  tier: text("tier").notNull().default("B"),
  ...timestamps,
});

export const salesOrders = sqliteTable("sales_orders", {
  id: text("id").primaryKey(),
  orderNo: text("order_no").notNull().unique(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  productModel: text("product_model").notNull(),
  quantity: integer("quantity").notNull().default(1),
  amount: real("amount").notNull().default(0),
  currency: text("currency").notNull().default("CNY"),
  deliveryDate: text("delivery_date").notNull(),
  status: text("status").notNull().default("confirmed"),
  ...timestamps,
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  productModel: text("product_model").notNull(),
  motorCode: text("motor_code").notNull().default(""),
  category: text("category").notNull(),
  source: text("source").notNull(),
  customerId: text("customer_id")
    .notNull()
    .references(() => customers.id),
  orderId: text("order_id").references(() => salesOrders.id),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  trackerName: text("tracker_name").notNull().default(""),
  stage: text("stage").notNull().default("initiation"),
  status: text("status").notNull().default("planning"),
  progress: integer("progress").notNull().default(0),
  riskLevel: text("risk_level").notNull().default("low"),
  plannedStart: text("planned_start").notNull(),
  plannedEnd: text("planned_end").notNull(),
  actualEnd: text("actual_end"),
  budget: real("budget").notNull().default(0),
  spent: real("spent").notNull().default(0),
  targetCost: real("target_cost").notNull().default(0),
  priority: text("priority").notNull().default("normal"),
  description: text("description").notNull().default(""),
  ...timestamps,
}, (table) => [
  index("projects_status_idx").on(table.status),
]);

export const projectMembers = sqliteTable("project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  responsibility: text("responsibility").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("project_members_project_user_unique").on(
    table.projectId,
    table.userId,
  ),
]);

export const milestones = sqliteTable("milestones", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  gateCode: text("gate_code").notNull(),
  name: text("name").notNull(),
  department: text("department").notNull(),
  ownerName: text("owner_name").notNull(),
  plannedDate: text("planned_date").notNull(),
  actualDate: text("actual_date"),
  status: text("status").notNull().default("not_started"),
  progress: integer("progress").notNull().default(0),
  requiredForm: text("required_form").notNull().default(""),
  evidenceCount: integer("evidence_count").notNull().default(0),
  note: text("note").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
}, (table) => [
  index("milestones_project_idx").on(table.projectId, table.sortOrder),
]);

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  formCode: text("form_code").notNull(),
  formName: text("form_name").notNull(),
  submitterId: text("submitter_id")
    .notNull()
    .references(() => users.id),
  approverRole: text("approver_role").notNull(),
  status: text("status").notNull().default("pending"),
  submittedAt: text("submitted_at").notNull(),
  dueAt: text("due_at").notNull(),
  decisionAt: text("decision_at"),
  decisionBy: text("decision_by").references(() => users.id),
  comment: text("comment").notNull().default(""),
  ...timestamps,
}, (table) => [
  index("approvals_status_idx").on(table.status, table.dueAt),
]);

export const issues = sqliteTable("issues", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  title: text("title").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  status: text("status").notNull().default("open"),
  dueDate: text("due_date").notNull(),
  resolution: text("resolution").notNull().default(""),
  ...timestamps,
});

export const changeRequests = sqliteTable("change_requests", {
  id: text("id").primaryKey(),
  changeNo: text("change_no").notNull().unique(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  changeType: text("change_type").notNull(),
  title: text("title").notNull(),
  reason: text("reason").notNull(),
  initiatorId: text("initiator_id")
    .notNull()
    .references(() => users.id),
  affectedObject: text("affected_object").notNull(),
  supplierNotice: integer("supplier_notice", { mode: "boolean" })
    .notNull()
    .default(false),
  customerNotice: integer("customer_notice", { mode: "boolean" })
    .notNull()
    .default(false),
  disposition: text("disposition").notNull().default("待评估"),
  status: text("status").notNull().default("draft"),
  dueDate: text("due_date").notNull(),
  ...timestamps,
});

export const formRecords = sqliteTable("form_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  formCode: text("form_code").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  payload: text("payload").notNull().default("{}"),
  updatedBy: text("updated_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("form_records_project_form_unique").on(
    table.projectId,
    table.formCode,
  ),
  index("form_records_project_idx").on(table.projectId, table.formCode),
]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  formCode: text("form_code").notNull().default(""),
  fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  version: text("version").notNull().default("A1"),
  uploadedBy: text("uploaded_by").notNull(),
  ...timestamps,
}, (table) => [
  index("documents_project_idx").on(table.projectId),
]);

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  actorId: text("actor_id")
    .notNull()
    .references(() => users.id),
  action: text("action").notNull(),
  detail: text("detail").notNull(),
  ...timestamps,
});

// V2 全流程架构使用 npd_ 前缀，与首版数据表并存，避免重构时破坏旧数据。
export const npdUsers = sqliteTable("npd_users", {
  id: text("id").primaryKey(),
  authUserId: text("auth_user_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  department: text("department").notNull(),
  role: text("role").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  bootstrapAdmin: integer("bootstrap_admin", { mode: "boolean" })
    .notNull()
    .default(false),
  passwordSalt: text("password_salt"),
  passwordHash: text("password_hash"),
  lastLoginAt: text("last_login_at"),
  ...timestamps,
});

export const npdLocalSessions = sqliteTable("npd_local_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => npdUsers.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_npd_local_sessions_user").on(table.userId, table.expiresAt),
]);

export const npdCustomers = sqliteTable("npd_customers", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  contact: text("contact").notNull().default(""),
  phone: text("phone").notNull().default(""),
  ...timestamps,
});

export const npdProjects = sqliteTable("npd_projects", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  seriesName: text("series_name").notNull(),
  category: text("category").notNull(),
  source: text("source").notNull(),
  customerId: text("customer_id")
    .notNull()
    .references(() => npdCustomers.id),
  initiatorId: text("initiator_id")
    .notNull()
    .references(() => npdUsers.id),
  ownerId: text("owner_id")
    .notNull()
    .references(() => npdUsers.id),
  status: text("status").notNull().default("draft"),
  riskLevel: text("risk_level").notNull().default("low"),
  currentSheetCode: text("current_sheet_code").notNull().default("initiation"),
  progress: integer("progress").notNull().default(0),
  plannedStart: text("planned_start").notNull(),
  plannedEnd: text("planned_end").notNull(),
  actualEnd: text("actual_end"),
  priority: text("priority").notNull().default("normal"),
  description: text("description").notNull().default(""),
  ...timestamps,
}, (table) => [
  index("idx_npd_projects_status").on(table.status),
  index("idx_npd_projects_owner").on(table.ownerId, table.status),
  index("idx_npd_projects_initiator").on(table.initiatorId, table.status),
]);

export const npdSalesOrders = sqliteTable("npd_sales_orders", {
  id: text("id").primaryKey(),
  orderNo: text("order_no").notNull().unique(),
  customerId: text("customer_id")
    .notNull()
    .references(() => npdCustomers.id),
  projectId: text("project_id").references(() => npdProjects.id),
  productSummary: text("product_summary").notNull(),
  quantity: integer("quantity").notNull().default(1),
  amount: real("amount").notNull().default(0),
  currency: text("currency").notNull().default("CNY"),
  orderDate: text("order_date").notNull(),
  deliveryDate: text("delivery_date").notNull(),
  status: text("status").notNull().default("confirmed"),
  createdBy: text("created_by")
    .notNull()
    .references(() => npdUsers.id),
  ...timestamps,
}, (table) => [
  index("idx_npd_orders_project").on(table.projectId, table.status),
  index("idx_npd_orders_customer").on(table.customerId, table.deliveryDate),
]);

export const npdProjectMembers = sqliteTable("npd_project_members", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  userId: text("user_id")
    .notNull()
    .references(() => npdUsers.id),
  responsibility: text("responsibility").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_npd_members_project_user").on(table.projectId, table.userId),
  index("idx_npd_members_user").on(table.userId, table.projectId),
]);

export const npdProjectMotors = sqliteTable("npd_project_motors", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  model: text("model").notNull(),
  motorCode: text("motor_code").notNull().default(""),
  ratedPower: text("rated_power").notNull().default(""),
  voltage: text("voltage").notNull().default(""),
  frequency: text("frequency").notNull().default("50Hz"),
  poles: text("poles").notNull().default(""),
  speed: text("speed").notNull().default(""),
  frameSize: text("frame_size").notNull().default(""),
  mounting: text("mounting").notNull().default(""),
  terminalMode: text("terminal_mode").notNull().default(""),
  protectionGrade: text("protection_grade").notNull().default(""),
  insulationClass: text("insulation_class").notNull().default(""),
  coolingMethod: text("cooling_method").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  designRevision: integer("design_revision").notNull().default(1),
  inspectionRequirement: text("inspection_requirement").notNull().default(""),
  testRequirement: text("test_requirement").notNull().default(""),
  plannedDate: text("planned_date").notNull(),
  actualDate: text("actual_date"),
  status: text("status").notNull().default("planned"),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_npd_motors_project_model").on(table.projectId, table.model),
  index("idx_npd_motors_project").on(table.projectId),
]);

export const npdProjectSheets = sqliteTable("npd_project_sheets", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  code: text("code").notNull(),
  title: text("title").notNull(),
  sortOrder: integer("sort_order").notNull(),
  ownerRole: text("owner_role").notNull(),
  status: text("status").notNull().default("not_started"),
  progress: integer("progress").notNull().default(0),
  plannedDate: text("planned_date").notNull(),
  actualDate: text("actual_date"),
  version: integer("version").notNull().default(1),
  note: text("note").notNull().default(""),
  updatedBy: text("updated_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_npd_sheets_project_code").on(table.projectId, table.code),
  index("idx_npd_sheets_project_order").on(table.projectId, table.sortOrder),
  index("idx_npd_sheets_status_date").on(table.status, table.plannedDate),
]);

export const npdFormRecords = sqliteTable("npd_form_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  formCode: text("form_code").notNull(),
  sheetCode: text("sheet_code").notNull(),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  payload: text("payload").notNull().default("{}"),
  updatedBy: text("updated_by").notNull(),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_npd_forms_project_form").on(table.projectId, table.formCode),
  index("idx_npd_forms_project_sheet").on(table.projectId, table.sheetCode),
]);

export const npdPartItems = sqliteTable("npd_part_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  motorId: text("motor_id").references(() => npdProjectMotors.id),
  partNo: text("part_no").notNull(),
  name: text("name").notNull(),
  specification: text("specification").notNull().default(""),
  material: text("material").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  sourceType: text("source_type").notNull().default("自制"),
  designOutputRef: text("design_output_ref").notNull().default(""),
  inspectionRequirement: text("inspection_requirement").notNull().default(""),
  testRequirement: text("test_requirement").notNull().default(""),
  plannedDate: text("planned_date").notNull(),
  actualDate: text("actual_date"),
  status: text("status").notNull().default("planned"),
  confirmedBy: text("confirmed_by").references(() => npdUsers.id),
  confirmedAt: text("confirmed_at"),
  designRevision: integer("design_revision").notNull().default(1),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_npd_parts_project_no_motor").on(
    table.projectId,
    table.partNo,
    table.motorId,
  ),
  index("idx_npd_parts_project_status").on(table.projectId, table.status),
]);

export const npdDocuments = sqliteTable("npd_documents", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  sheetCode: text("sheet_code").notNull(),
  motorId: text("motor_id").references(() => npdProjectMotors.id),
  linkedRecordId: text("linked_record_id"),
  kind: text("kind").notNull().default("attachment"),
  fileName: text("file_name").notNull(),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  version: text("version").notNull().default("A1"),
  uploadedBy: text("uploaded_by").notNull(),
  ...timestamps,
}, (table) => [
  index("idx_npd_documents_project_sheet").on(table.projectId, table.sheetCode),
  index("idx_npd_documents_record").on(table.linkedRecordId),
]);

export const npdTestReports = sqliteTable("npd_test_reports", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  motorId: text("motor_id")
    .notNull()
    .references(() => npdProjectMotors.id),
  reportNo: text("report_no").notNull(),
  reportType: text("report_type").notNull(),
  title: text("title").notNull(),
  requirementRef: text("requirement_ref").notNull().default(""),
  testDate: text("test_date").notNull(),
  result: text("result").notNull(),
  conclusion: text("conclusion").notNull().default(""),
  documentId: text("document_id").references(() => npdDocuments.id),
  requirementRevision: integer("requirement_revision").notNull().default(1),
  submittedBy: text("submitted_by")
    .notNull()
    .references(() => npdUsers.id),
  ...timestamps,
}, (table) => [
  uniqueIndex("idx_npd_tests_project_report_no").on(table.projectId, table.reportNo),
  index("idx_npd_tests_motor").on(table.motorId, table.testDate),
]);

export const npdInspectionRecords = sqliteTable("npd_inspection_records", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  motorId: text("motor_id").references(() => npdProjectMotors.id),
  partItemId: text("part_item_id").references(() => npdPartItems.id),
  itemType: text("item_type").notNull(),
  inspectionRequirement: text("inspection_requirement").notNull(),
  designOutputRef: text("design_output_ref").notNull().default(""),
  inspectionDate: text("inspection_date").notNull(),
  result: text("result").notNull(),
  conclusion: text("conclusion").notNull().default(""),
  documentId: text("document_id").references(() => npdDocuments.id),
  requirementRevision: integer("requirement_revision").notNull().default(1),
  inspectorId: text("inspector_id")
    .notNull()
    .references(() => npdUsers.id),
  ...timestamps,
}, (table) => [
  index("idx_npd_inspections_project_date").on(table.projectId, table.inspectionDate),
  index("idx_npd_inspections_motor_part").on(table.motorId, table.partItemId),
]);

export const npdSheetRevisions = sqliteTable("npd_sheet_revisions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => npdProjects.id),
  sheetCode: text("sheet_code").notNull(),
  version: integer("version").notNull(),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull(),
  progress: integer("progress").notNull().default(0),
  plannedDate: text("planned_date").notNull(),
  actorId: text("actor_id")
    .notNull()
    .references(() => npdUsers.id),
  snapshot: text("snapshot").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_npd_sheet_revisions_version").on(
    table.projectId,
    table.sheetCode,
    table.version,
  ),
  index("idx_npd_sheet_revisions_timeline").on(
    table.projectId,
    table.sheetCode,
    table.createdAt,
  ),
]);

export const npdActivities = sqliteTable("npd_activities", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => npdProjects.id),
  actorId: text("actor_id")
    .notNull()
    .references(() => npdUsers.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull().default("project"),
  entityId: text("entity_id"),
  detail: text("detail").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_npd_activities_project_time").on(table.projectId, table.createdAt),
  index("idx_npd_activities_actor_time").on(table.actorId, table.createdAt),
]);

export const npdDashboardPreferences = sqliteTable("npd_dashboard_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => npdUsers.id),
  payload: text("payload").notNull().default("{}"),
  ...timestamps,
});
