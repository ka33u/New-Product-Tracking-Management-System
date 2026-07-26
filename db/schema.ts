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
