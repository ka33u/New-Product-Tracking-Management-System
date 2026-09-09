import { env } from "cloudflare:workers";
import { reserveLocalLoginAttempt } from "./login-limits";
import { defaultDashboardPreference, projectOverdueDays, readDashboardPreference, validateDashboardPreference } from "../lib/dashboard-model";
import { inspectionEvidenceIssues, testEvidenceIssues } from "../lib/evidence-checks";
import { NpdConflictError, activityStatement, assertExpectedVersion, commitSheetRevision, loadRevisionContext, snapshotExpression, type SheetRevisionChange } from "./revision-transaction";
import type {
  DashboardPreference,
  InspectionRecord,
  NpdActivity,
  NpdCustomer,
  NpdDocument,
  NpdFormRecord,
  NpdProject,
  NpdRole,
  NpdSalesOrder,
  NpdUser,
  NpdWorkspaceSnapshot,
  PartItem,
  ProjectMember,
  ProjectMotor,
  ProjectSheet,
  ProjectStatus,
  RiskLevel,
  SheetCode,
  SheetRevision,
  SheetStatus,
  TestReport,
} from "../lib/npd-v2";
import { roleLabels } from "../lib/npd-v2";
import {
  assignableOwner,
  canCreateProject,
  canEditSheet,
  canSeeProject,
  isProjectSteward,
} from "../lib/access-v2";
import { formDefinitions, formReleaseIssues, formSubmissionIssues } from "../lib/forms";
import {
  formToSheet,
  sheetByCode,
  sheetDefinitions,
  sheetScheduleRatios,
} from "../lib/sheets-v2";

type Row = Record<string, string | number | null>;
type RuntimeEnv = {
  DB?: D1Database;
  FILES?: R2Bucket;
  NPD_OWNER_EMAIL?: string;
  NPD_DEMO_DATA?: string;
  NPD_AUTH_MODE?: string;
};

let initializationPromise: Promise<void> | null = null;

export function getNpdRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}

function getDatabase() {
  const database = getNpdRuntimeEnv().DB;
  if (!database) {
    throw new Error("D1 数据库未绑定，请检查 .openai/hosting.json 的 DB 配置。");
  }
  return database;
}

export async function ensureNpdDatabase() {
  if (!initializationPromise) {
    initializationPromise = initializeNpdDatabase().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  await initializationPromise;
}

async function initializeNpdDatabase() {
  const database = getDatabase();
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS npd_users (
      id TEXT PRIMARY KEY, auth_user_id TEXT UNIQUE, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      department TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      bootstrap_admin INTEGER NOT NULL DEFAULT 0,
      password_salt TEXT, password_hash TEXT, last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_local_sessions (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES npd_users(id),
      token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_customers (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      industry TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_projects (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      series_name TEXT NOT NULL, category TEXT NOT NULL, source TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES npd_customers(id),
      initiator_id TEXT NOT NULL REFERENCES npd_users(id),
      owner_id TEXT NOT NULL REFERENCES npd_users(id),
      status TEXT NOT NULL DEFAULT 'draft', risk_level TEXT NOT NULL DEFAULT 'low',
      current_sheet_code TEXT NOT NULL DEFAULT 'initiation', progress INTEGER NOT NULL DEFAULT 0,
      planned_start TEXT NOT NULL, planned_end TEXT NOT NULL, actual_end TEXT,
      priority TEXT NOT NULL DEFAULT 'normal', description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_sales_orders (
      id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL REFERENCES npd_customers(id),
      project_id TEXT REFERENCES npd_projects(id), product_summary TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1, amount REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY', order_date TEXT NOT NULL,
      delivery_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
      created_by TEXT NOT NULL REFERENCES npd_users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_project_members (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      user_id TEXT NOT NULL REFERENCES npd_users(id), responsibility TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_project_motors (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      model TEXT NOT NULL, motor_code TEXT NOT NULL DEFAULT '', rated_power TEXT NOT NULL DEFAULT '',
      voltage TEXT NOT NULL DEFAULT '', frequency TEXT NOT NULL DEFAULT '50Hz',
      poles TEXT NOT NULL DEFAULT '', speed TEXT NOT NULL DEFAULT '', frame_size TEXT NOT NULL DEFAULT '',
      mounting TEXT NOT NULL DEFAULT '', terminal_mode TEXT NOT NULL DEFAULT '',
      protection_grade TEXT NOT NULL DEFAULT '', insulation_class TEXT NOT NULL DEFAULT '',
      cooling_method TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL DEFAULT 1,
      design_revision INTEGER NOT NULL DEFAULT 1,
      inspection_requirement TEXT NOT NULL DEFAULT '', test_requirement TEXT NOT NULL DEFAULT '',
      planned_date TEXT NOT NULL, actual_date TEXT, status TEXT NOT NULL DEFAULT 'planned',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_project_sheets (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      code TEXT NOT NULL, title TEXT NOT NULL, sort_order INTEGER NOT NULL,
      owner_role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'not_started',
      progress INTEGER NOT NULL DEFAULT 0, planned_date TEXT NOT NULL, actual_date TEXT,
      version INTEGER NOT NULL DEFAULT 1, note TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_form_records (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      form_code TEXT NOT NULL, sheet_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL DEFAULT '{}',
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_part_items (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      motor_id TEXT REFERENCES npd_project_motors(id), part_no TEXT NOT NULL, name TEXT NOT NULL,
      specification TEXT NOT NULL DEFAULT '', material TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1, source_type TEXT NOT NULL DEFAULT '自制',
      design_output_ref TEXT NOT NULL DEFAULT '', inspection_requirement TEXT NOT NULL DEFAULT '',
      test_requirement TEXT NOT NULL DEFAULT '', planned_date TEXT NOT NULL, actual_date TEXT,
      status TEXT NOT NULL DEFAULT 'planned', confirmed_by TEXT REFERENCES npd_users(id),
      confirmed_at TEXT, design_revision INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_documents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      sheet_code TEXT NOT NULL, motor_id TEXT REFERENCES npd_project_motors(id),
      linked_record_id TEXT, kind TEXT NOT NULL DEFAULT 'attachment', file_name TEXT NOT NULL,
      object_key TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL,
      version TEXT NOT NULL DEFAULT 'A1', uploaded_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_test_reports (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      motor_id TEXT NOT NULL REFERENCES npd_project_motors(id), report_no TEXT NOT NULL,
      report_type TEXT NOT NULL, title TEXT NOT NULL, requirement_ref TEXT NOT NULL DEFAULT '',
      test_date TEXT NOT NULL, result TEXT NOT NULL, conclusion TEXT NOT NULL DEFAULT '',
      document_id TEXT REFERENCES npd_documents(id),
      requirement_revision INTEGER NOT NULL DEFAULT 1,
      submitted_by TEXT NOT NULL REFERENCES npd_users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_inspection_records (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      motor_id TEXT REFERENCES npd_project_motors(id), part_item_id TEXT REFERENCES npd_part_items(id),
      item_type TEXT NOT NULL, inspection_requirement TEXT NOT NULL,
      design_output_ref TEXT NOT NULL DEFAULT '', inspection_date TEXT NOT NULL,
      result TEXT NOT NULL, conclusion TEXT NOT NULL DEFAULT '',
      document_id TEXT REFERENCES npd_documents(id),
      requirement_revision INTEGER NOT NULL DEFAULT 1,
      inspector_id TEXT NOT NULL REFERENCES npd_users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_sheet_revisions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES npd_projects(id),
      sheet_code TEXT NOT NULL, version INTEGER NOT NULL, action TEXT NOT NULL,
      summary TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0, planned_date TEXT NOT NULL,
      actor_id TEXT NOT NULL REFERENCES npd_users(id), snapshot TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_activities (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES npd_projects(id),
      actor_id TEXT NOT NULL REFERENCES npd_users(id), action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'project', entity_id TEXT,
      detail TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS npd_dashboard_preferences (
      user_id TEXT PRIMARY KEY REFERENCES npd_users(id), payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS idx_npd_projects_status ON npd_projects(status)",
    "CREATE INDEX IF NOT EXISTS idx_npd_local_sessions_user ON npd_local_sessions(user_id, expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_npd_projects_owner ON npd_projects(owner_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_npd_projects_initiator ON npd_projects(initiator_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_npd_orders_project ON npd_sales_orders(project_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_npd_orders_customer ON npd_sales_orders(customer_id, delivery_date)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_npd_members_project_user ON npd_project_members(project_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_npd_members_user ON npd_project_members(user_id, project_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_npd_motors_project_model ON npd_project_motors(project_id, model)",
    "CREATE INDEX IF NOT EXISTS idx_npd_motors_project ON npd_project_motors(project_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_npd_sheets_project_code ON npd_project_sheets(project_id, code)",
    "CREATE INDEX IF NOT EXISTS idx_npd_sheets_project_order ON npd_project_sheets(project_id, sort_order)",
    "CREATE INDEX IF NOT EXISTS idx_npd_sheets_status_date ON npd_project_sheets(status, planned_date)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_npd_forms_project_form ON npd_form_records(project_id, form_code)",
    "CREATE INDEX IF NOT EXISTS idx_npd_forms_project_sheet ON npd_form_records(project_id, sheet_code)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_npd_parts_project_no_motor ON npd_part_items(project_id, part_no, motor_id)",
    "CREATE INDEX IF NOT EXISTS idx_npd_parts_project_status ON npd_part_items(project_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_npd_documents_project_sheet ON npd_documents(project_id, sheet_code)",
    "CREATE INDEX IF NOT EXISTS idx_npd_documents_record ON npd_documents(linked_record_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_npd_tests_project_report_no ON npd_test_reports(project_id, report_no)",
    "CREATE INDEX IF NOT EXISTS idx_npd_tests_motor ON npd_test_reports(motor_id, test_date)",
    "CREATE INDEX IF NOT EXISTS idx_npd_inspections_project_date ON npd_inspection_records(project_id, inspection_date)",
    "CREATE INDEX IF NOT EXISTS idx_npd_inspections_motor_part ON npd_inspection_records(motor_id, part_item_id)",
    "CREATE INDEX IF NOT EXISTS idx_npd_activities_project_time ON npd_activities(project_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_npd_activities_actor_time ON npd_activities(actor_id, created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_npd_sheet_revisions_version ON npd_sheet_revisions(project_id, sheet_code, version)",
    "CREATE INDEX IF NOT EXISTS idx_npd_sheet_revisions_timeline ON npd_sheet_revisions(project_id, sheet_code, created_at)",
  ];

  await database.batch(schemaStatements.map((sql) => database.prepare(sql)));
  const count = await database
    .prepare("SELECT COUNT(*) AS count FROM npd_projects")
    .first<{ count: number }>();
  const users = await database.prepare("SELECT COUNT(*) AS count FROM npd_users").first<{ count: number }>();
  if (!count?.count && !users?.count && getNpdRuntimeEnv().NPD_DEMO_DATA === "1") await seedNpdDatabase(database);
  await repairRoleAndRevisionCoverage(database);
  await repairDemoConsistency(database);
  await database.prepare("PRAGMA optimize").run();
}

async function repairRoleAndRevisionCoverage(database: D1Database) {
  const projects = await database.prepare("SELECT id FROM npd_projects WHERE id IN ('npd-p-001','npd-p-002','npd-p-003','npd-p-004')").all<Row>();
  if (projects.results.length) await database.batch([
    database.prepare(`INSERT OR IGNORE INTO npd_users
      (id,email,name,department,role,active,bootstrap_admin)
      VALUES ('npd-u-process','process@hengda-motor.local','张伟','技术部·工艺科','process',1,0)`),
    database.prepare(`INSERT OR IGNORE INTO npd_users
      (id,email,name,department,role,active,bootstrap_admin)
      VALUES ('npd-u-procurement','procurement@hengda-motor.local','孙悦','采购部','procurement',1,0)`),
    database.prepare(`UPDATE npd_project_motors SET
      terminal_mode=CASE WHEN trim(terminal_mode)='' THEN '接线盒顶部出线' ELSE terminal_mode END,
      protection_grade=CASE WHEN trim(protection_grade)='' THEN 'IP55' ELSE protection_grade END,
      insulation_class=CASE WHEN trim(insulation_class)='' THEN 'F级' ELSE insulation_class END,
      cooling_method=CASE WHEN trim(cooling_method)='' THEN 'IC411' ELSE cooling_method END
      WHERE project_id IN ('npd-p-001','npd-p-002','npd-p-003','npd-p-004')`),
  ]);
  const statements: D1PreparedStatement[] = [];
  for (const project of projects.results) {
    for (const [userId, responsibility] of [
      ["npd-u-process", "工艺方案、工装及可制造性确认"],
      ["npd-u-procurement", "外购外协件询价、供应商与到料节点"],
    ]) {
      statements.push(database.prepare(`INSERT OR IGNORE INTO npd_project_members
        (id,project_id,user_id,responsibility) VALUES (?,?,?,?)`).bind(
        makeId("member"), String(project.id), userId, responsibility,
      ));
    }
  }
  statements.push(database.prepare(`INSERT OR IGNORE INTO npd_sheet_revisions (
    id,project_id,sheet_code,version,action,summary,reason,status,progress,
    planned_date,actor_id,snapshot,created_at
  ) SELECT 'revision-' || lower(hex(randomblob(12))),s.project_id,s.code,s.version,
    '历史版本基线','升级版本管理时保留的当前阶段基线','系统升级',s.status,
    s.progress,s.planned_date,s.updated_by,
    json_object('source','upgrade_baseline','note',s.note),s.updated_at
    FROM npd_project_sheets s
    WHERE NOT EXISTS (SELECT 1 FROM npd_sheet_revisions r
      WHERE r.project_id=s.project_id AND r.sheet_code=s.code AND r.version=s.version)`));
  if (statements.length) await database.batch(statements);
}

async function repairDemoConsistency(database: D1Database) {
  const marker = await database.prepare(`SELECT id FROM npd_activities
    WHERE entity_type='system_migration' AND entity_id='v2-seed-consistency-1'`).first<Row>();
  if (marker) return;
  const demo = await database.prepare("SELECT id FROM npd_projects WHERE id='npd-p-001'").first<Row>();
  if (!demo) return;
  await database.batch([
    database.prepare(`UPDATE npd_part_items SET status='completed',
      actual_date=COALESCE(actual_date,planned_date),confirmed_by='npd-u-production',
      confirmed_at=COALESCE(confirmed_at,planned_date),updated_at=CURRENT_TIMESTAMP
      WHERE id IN ('npd-part-002','npd-part-003')`),
    database.prepare(`UPDATE npd_project_sheets SET status='in_progress',progress=30,
      updated_by='npd-u-tester',updated_at=CURRENT_TIMESTAMP
      WHERE project_id='npd-p-001' AND code='verification'`),
    database.prepare(`UPDATE npd_project_sheets SET status='in_progress',progress=15,
      updated_by='npd-u-quality',updated_at=CURRENT_TIMESTAMP
      WHERE project_id='npd-p-001' AND code='quality_inspection'`),
    database.prepare(`UPDATE npd_project_sheets SET status='blocked',progress=0,
      updated_by='npd-u-production',note='电磁制动器热容量数据待供应商确认。',
      updated_at=CURRENT_TIMESTAMP WHERE project_id='npd-p-002' AND code='parts_plan'`),
    database.prepare(`INSERT OR IGNORE INTO npd_activities
      (id,project_id,actor_id,action,entity_type,entity_id,detail)
      VALUES (?,NULL,'npd-u-admin','校准演示数据','system_migration',
      'v2-seed-consistency-1','已统一演示项目的阶段状态、明细节点和聚合进度口径。')`).bind(
      makeId("activity"),
    ),
  ]);
  for (const projectId of ["npd-p-001", "npd-p-002", "npd-p-003", "npd-p-004"]) {
    await recalculateProject(database, projectId);
  }
}

async function seedNpdDatabase(database: D1Database) {
  const today = currentDateIso();
  const users = [
    ["npd-u-admin", "admin@hengda-motor.local", "谢鹏程", "信息化办公室", "admin"],
    ["npd-u-sales", "sales@hengda-motor.local", "徐杰", "销售部", "sales"],
    ["npd-u-design", "design@hengda-motor.local", "王琳", "技术部·设计科", "design"],
    ["npd-u-process", "process@hengda-motor.local", "张伟", "技术部·工艺科", "process"],
    ["npd-u-procurement", "procurement@hengda-motor.local", "孙悦", "采购部", "procurement"],
    ["npd-u-production", "production@hengda-motor.local", "吴军", "生产部", "production"],
    ["npd-u-tester", "tester@hengda-motor.local", "赵敏", "试验中心", "tester"],
    ["npd-u-quality", "quality@hengda-motor.local", "周宁", "质量部", "quality"],
  ];
  const customers = [
    ["npd-c-001", "KH-0186", "江苏海川泵业有限公司", "工业泵", "李晨", "138****6812"],
    ["npd-c-002", "KH-0112", "青岛港机装备集团", "港口起重", "赵海", "186****0933"],
    ["npd-c-003", "KH-0241", "苏州热工装备有限公司", "工业炉风机", "沈工", "139****7218"],
    ["npd-c-004", "KH-0268", "宁波精工传动科技", "通用机械", "郑磊", "137****3169"],
  ];
  const projects = [
    ["npd-p-001", "NP-2026-018", "IE5 超高效异步电机系列开发", "HE5 高效系列", "全新产品", "客户订单", "npd-c-001", "npd-u-sales", "npd-u-design", "active", "medium", "verification", 66, addDays(today, -118), addDays(today, 24), null, "high", "覆盖 132～180 机座的 IE5 泵用异步电机平台，完成效率、温升和噪声验证。"],
    ["npd-p-002", "NP-2026-021", "港机变频制动电机系列", "YVF2 港机系列", "全新产品", "客户订单", "npd-c-002", "npd-u-sales", "npd-u-design", "active", "high", "parts_plan", 45, addDays(today, -82), addDays(today, 48), null, "urgent", "面向港机频繁制动和盐雾工况，覆盖两种中心高规格。"],
    ["npd-p-003", "NP-2026-023", "高温炉循环风机电机", "YKK 高温系列", "派生产品", "行业需求", "npd-c-003", "npd-u-design", "npd-u-design", "active", "medium", "input_output", 18, addDays(today, -30), addDays(today, 95), null, "high", "高环境温度与粉尘工况，强化绝缘、轴承冷却和防护结构。"],
    ["npd-p-004", "NP-2026-012", "高效率通用电机降本迭代", "YE4 通用系列", "改进产品", "内部研发", "npd-c-004", "npd-u-design", "npd-u-design", "completed", "low", "change_archive", 100, addDays(today, -210), addDays(today, -65), addDays(today, -68), "normal", "完成材料替代和通用化设计，效率不变，单台成本下降 7.8%。"],
  ];

  const statements: D1PreparedStatement[] = [];
  users.forEach((row) => statements.push(database.prepare(
    "INSERT OR IGNORE INTO npd_users (id,email,name,department,role) VALUES (?,?,?,?,?)",
  ).bind(...row)));
  customers.forEach((row) => statements.push(database.prepare(
    "INSERT OR IGNORE INTO npd_customers (id,code,name,industry,contact,phone) VALUES (?,?,?,?,?,?)",
  ).bind(...row)));
  projects.forEach((row) => statements.push(database.prepare(`INSERT OR IGNORE INTO npd_projects (
    id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,
    status,risk_level,current_sheet_code,progress,planned_start,planned_end,actual_end,
    priority,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...row)));
  await database.batch(statements);

  const orderRows = [
    ["npd-o-001", "SO-2026-0816", "npd-c-001", "npd-p-001", "HE5-132S/160M/180M 高效电机", 5, 286000, "CNY", addDays(today, -126), addDays(today, 38), "in_development", "npd-u-sales"],
    ["npd-o-002", "SO-2026-0932", "npd-c-002", "npd-p-002", "YVF2-250M/280S 港机制动电机", 2, 418000, "CNY", addDays(today, -91), addDays(today, 66), "in_development", "npd-u-sales"],
    ["npd-o-003", "SO-2026-1068", "npd-c-003", "npd-p-003", "YKK-355M-4 高温风机电机", 1, 328000, "CNY", addDays(today, -36), addDays(today, 110), "in_development", "npd-u-sales"],
    ["npd-o-004", "SO-2026-0721", "npd-c-004", "npd-p-004", "YE4-112M-4 通用高效电机", 2, 36000, "CNY", addDays(today, -220), addDays(today, -58), "completed", "npd-u-sales"],
    ["npd-o-005", "SO-2026-1185", "npd-c-001", null, "矿用隔爆电机询单转订单", 3, 512000, "CNY", addDays(today, -4), addDays(today, 150), "confirmed", "npd-u-sales"],
  ];
  await database.batch(orderRows.map((row) => database.prepare(`INSERT OR IGNORE INTO npd_sales_orders (
    id,order_no,customer_id,project_id,product_summary,quantity,amount,currency,
    order_date,delivery_date,status,created_by
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...row)));

  await seedMembers(database, projects);
  await seedMotors(database, today);
  await seedSheets(database, projects);
  await seedDetails(database, today);
}

async function seedMembers(database: D1Database, projects: unknown[][]) {
  const statements: D1PreparedStatement[] = [];
  const support: Array<[string, string]> = [
    ["npd-u-process", "工艺方案、工装及可制造性确认"],
    ["npd-u-procurement", "外购外协件询价、供应商与到料节点"],
    ["npd-u-production", "整机及零部件节点确认"],
    ["npd-u-tester", "型式试验与验证报告"],
    ["npd-u-quality", "零部件及整机质量检验"],
  ];
  for (const project of projects) {
    const projectId = String(project[0]);
    const initiatorId = String(project[7]);
    const ownerId = String(project[8]);
    const unique = new Map<string, string>([
      [initiatorId, "项目发起与客户需求"],
      [ownerId, "项目总负责人"],
      ...support,
    ]);
    for (const [userId, responsibility] of unique) {
      statements.push(database.prepare(
        "INSERT OR IGNORE INTO npd_project_members (id,project_id,user_id,responsibility) VALUES (?,?,?,?)",
      ).bind(makeId("mem"), projectId, userId, responsibility));
    }
  }
  await database.batch(statements);
}

async function seedMotors(database: D1Database, today: string) {
  const rows = [
    ["npd-m-001", "npd-p-001", "HE5-132S-4", "", "5.5kW", "380V", "50Hz", "4", "1450r/min", "132S", "B3", "接线盒顶部出线", "IP55", "F级", "IC411", 2, "效率、温升、噪声、振动及装配尺寸全检", "型式试验：效率、温升、堵转、最大转矩、超速", addDays(today, -10), addDays(today, -11), "completed"],
    ["npd-m-002", "npd-p-001", "HE5-160M-4", "", "11kW", "380V", "50Hz", "4", "1465r/min", "160M", "B3", "接线盒顶部出线", "IP55", "F级", "IC411", 2, "效率、温升、噪声、振动及装配尺寸全检", "型式试验：效率、温升、堵转、最大转矩、超速", addDays(today, 4), null, "in_progress"],
    ["npd-m-003", "npd-p-001", "HE5-180M-4", "", "18.5kW", "380V", "50Hz", "4", "1470r/min", "180M", "B3", "接线盒顶部出线", "IP55", "F级", "IC411", 1, "效率、温升、噪声、振动及装配尺寸全检", "型式试验：效率、温升、堵转、最大转矩、超速", addDays(today, 12), null, "planned"],
    ["npd-m-004", "npd-p-002", "YVF2-250M-6", "", "37kW", "380V", "50Hz", "6", "985r/min", "250M", "B3", "接线盒右侧出线", "IP56", "F级", "IC416", 1, "制动器接口、盐雾防护、轴伸尺寸和动平衡", "低频转矩、频繁制动热容量、盐雾与振动试验", addDays(today, 18), null, "in_progress"],
    ["npd-m-005", "npd-p-002", "YVF2-280S-6", "", "45kW", "380V", "50Hz", "6", "990r/min", "280S", "B3", "接线盒右侧出线", "IP56", "F级", "IC416", 1, "制动器接口、盐雾防护、轴伸尺寸和动平衡", "低频转矩、频繁制动热容量、盐雾与振动试验", addDays(today, 28), null, "planned"],
    ["npd-m-006", "npd-p-003", "YKK-355M-4", "", "250kW", "6000V", "50Hz", "4", "1490r/min", "355M", "IMB3", "接线盒右侧出线", "IP54", "F级", "IC611", 1, "高温绝缘体系、轴承游隙、冷却风路和防护等级", "高温环境温升、绝缘寿命、振动及噪声试验", addDays(today, 58), null, "planned"],
    ["npd-m-007", "npd-p-004", "YE4-112M-4", "", "4kW", "380V", "50Hz", "4", "1440r/min", "112M", "B3", "接线盒顶部出线", "IP55", "F级", "IC411", 2, "效率和材料替代专项检验", "效率与温升对比验证", addDays(today, -85), addDays(today, -88), "completed"],
  ];
  await database.batch(rows.map((row) => database.prepare(`INSERT OR IGNORE INTO npd_project_motors (
    id,project_id,model,motor_code,rated_power,voltage,frequency,poles,speed,frame_size,
    mounting,terminal_mode,protection_grade,insulation_class,cooling_method,quantity,
    inspection_requirement,test_requirement,planned_date,actual_date,status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...row)));
}

async function seedSheets(database: D1Database, projects: unknown[][]) {
  const currentIndex: Record<string, number> = {
    initiation: 0, input_output: 1, development_plan: 2, design_review: 3,
    parts_plan: 4, verification: 5, quality_inspection: 6, customer_trial: 7,
    identification: 8, change_archive: 9,
  };
  const statements: D1PreparedStatement[] = [];
  for (const project of projects) {
    const projectId = String(project[0]);
    const current = currentIndex[String(project[11])] ?? 0;
    const completedProject = project[9] === "completed";
    const start = String(project[13]);
    const end = String(project[14]);
    sheetDefinitions.forEach((sheet, index) => {
      const status = completedProject || index < current
        ? "completed"
        : index === current
          ? "in_progress"
          : "not_started";
      const plannedDate = interpolateDate(start, end, sheetScheduleRatios[index]);
      statements.push(database.prepare(`INSERT OR IGNORE INTO npd_project_sheets (
        id,project_id,code,title,sort_order,owner_role,status,progress,planned_date,
        actual_date,version,note,updated_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        makeId("sheet"), projectId, sheet.code, sheet.title, sheet.index,
        sheet.ownerRole, status, status === "completed" ? 100 : status === "in_progress" ? Number(project[12]) % 80 + 15 : 0,
        plannedDate, status === "completed" ? addDays(plannedDate, -1) : null,
        1, status === "in_progress" ? "当前阶段正在按计划推进。" : "", "npd-u-design",
      ));
      statements.push(database.prepare(`INSERT OR IGNORE INTO npd_sheet_revisions (
        id,project_id,sheet_code,version,action,summary,reason,status,progress,
        planned_date,actor_id,snapshot
      ) VALUES (?,?,?,1,'初始化阶段','演示项目初始化','系统初始化',?,?,?,?,?)`).bind(
        makeId("revision"), projectId, sheet.code, status,
        status === "completed" ? 100 : status === "in_progress" ? Number(project[12]) % 80 + 15 : 0,
        plannedDate, "npd-u-design", JSON.stringify({ source: "seed" }),
      ));
      if (status === "completed") {
        sheet.formCodes.forEach((formCode) => {
          statements.push(database.prepare(`INSERT OR IGNORE INTO npd_form_records
            (id,project_id,form_code,sheet_code,status,version,payload,updated_by)
            VALUES (?,?,?,?, 'submitted',1,?,?)`).bind(
            makeId("form"), projectId, formCode, sheet.code,
            JSON.stringify({ archiveSummary: "演示数据：该阶段记录已审核归档。" }),
            "npd-u-design",
          ));
        });
      }
    });
  }
  await database.batch(statements);
}

async function seedDetails(database: D1Database, today: string) {
  const parts = [
    ["npd-part-001", "npd-p-001", "npd-m-002", "160M-STAT", "定子冲片", "160M/4P", "50W470", 480, "外购", "DO-HE5-160-01", "材料牌号、尺寸、毛刺及叠压系数", "铁耗抽检", addDays(today, -8), addDays(today, -9), "completed", "npd-u-production", addDays(today, -9)],
    ["npd-part-002", "npd-p-001", "npd-m-002", "160M-ROTOR", "转子总成", "160M/4P", "铸铝转子", 1, "自制", "DO-HE5-160-02", "转子外径、斜槽、气孔及动平衡", "动平衡 G2.5", addDays(today, -2), null, "in_progress", null, null],
    ["npd-part-003", "npd-p-001", null, "HE5-FAN", "低损耗风扇", "HE5 通用", "PA66-GF30", 1, "外购", "DO-HE5-COM-04", "外观、尺寸、材料证明", "超速 1.2 倍 2min", addDays(today, 5), null, "planned", null, null],
    ["npd-part-004", "npd-p-002", "npd-m-004", "250M-BRAKE", "电磁制动器", "37kW/6P", "组件", 1, "外购", "DO-YVF2-250-08", "接口尺寸、制动力矩、防护等级", "制动热容量 120 次/小时", addDays(today, 6), null, "blocked", null, null],
  ];
  await database.batch(parts.map((row) => database.prepare(`INSERT OR IGNORE INTO npd_part_items (
    id,project_id,motor_id,part_no,name,specification,material,quantity,source_type,
    design_output_ref,inspection_requirement,test_requirement,planned_date,actual_date,
    status,confirmed_by,confirmed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...row)));

  await database.prepare(`INSERT OR IGNORE INTO npd_test_reports (
    id,project_id,motor_id,report_no,report_type,title,requirement_ref,test_date,
    result,conclusion,document_id,submitted_by
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    "npd-test-001", "npd-p-001", "npd-m-001", "TR-2026-081",
    "型式试验", "HE5-132S-4 型式试验报告", "DO-HE5-132-TEST",
    addDays(today, -12), "合格", "效率、温升和堵转指标满足设计输入。", null,
    "npd-u-tester",
  ).run();
  await database.prepare(`INSERT OR IGNORE INTO npd_inspection_records (
    id,project_id,motor_id,part_item_id,item_type,inspection_requirement,
    design_output_ref,inspection_date,result,conclusion,document_id,inspector_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    "npd-ins-001", "npd-p-001", "npd-m-001", null, "motor",
    "效率、温升、噪声、振动及装配尺寸全检", "DO-HE5-132-QC",
    addDays(today, -13), "合格", "整机检验项目全部满足放行要求。", null,
    "npd-u-quality",
  ).run();
  await addActivity(database, "npd-p-001", "npd-u-tester", "提交试验报告", "test_report", "npd-test-001", "HE5-132S-4 型式试验报告已提交，结论合格。" );
  await addActivity(database, "npd-p-002", "npd-u-production", "节点受阻", "part", "npd-part-004", "电磁制动器热容量数据待供应商确认。" );
}

export async function resolveNpdCurrentUser(
  email: string | null,
  fullName: string | null,
  authUserId: string | null = null,
): Promise<NpdUser> {
  await ensureNpdDatabase();
  const database = getDatabase();
  if (!email && process.env.NODE_ENV !== "production") {
    const demo = await database
      .prepare("SELECT * FROM npd_users WHERE id='npd-u-admin'")
      .first<Row>();
    if (!demo) throw new Error("本地演示管理员未初始化。");
    return mapUser(demo);
  }
  if (!email) {
    throw new Error("请先使用 ChatGPT 登录后再访问新品开发系统。");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const ownerEmail = getNpdRuntimeEnv().NPD_OWNER_EMAIL?.trim().toLowerCase();
  const isConfiguredOwner = Boolean(ownerEmail && normalizedEmail === ownerEmail);

  const normalizedAuthUserId = authUserId?.trim() || null;
  let row = await database
    .prepare(`SELECT * FROM npd_users WHERE
      (? IS NOT NULL AND auth_user_id=?) OR lower(email)=lower(?)`)
    .bind(normalizedAuthUserId, normalizedAuthUserId, normalizedEmail)
    .first<Row>();
  if (row && isConfiguredOwner &&
      (String(row.role) !== "admin" || !Boolean(row.active) || !Boolean(row.bootstrap_admin))) {
    await database.prepare(`UPDATE npd_users SET role='admin',active=1,bootstrap_admin=1,
      department=CASE WHEN department='' THEN '系统管理' ELSE department END,
      version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(String(row.id)).run();
    row = await database.prepare("SELECT * FROM npd_users WHERE id=?")
      .bind(String(row.id)).first<Row>();
  }
  if (!row) {
    if (!isConfiguredOwner) {
      const bootstrap = await database
        .prepare("SELECT COUNT(*) AS count FROM npd_users WHERE bootstrap_admin=1")
        .first<{ count: number }>();
      if (bootstrap?.count) {
        throw new Error("账号尚未开通，请联系管理员在人员与权限中创建账户。");
      }
    }
    const role: NpdRole = "admin";
    const id = makeId("user");
    await database.prepare(`INSERT OR IGNORE INTO npd_users
      (id,auth_user_id,email,name,department,role,active,bootstrap_admin)
      VALUES (?,?,?,?,?,?,1,?)`).bind(
      id,
      normalizedAuthUserId,
      normalizedEmail,
      fullName?.trim() || normalizedEmail.split("@")[0],
      "系统管理",
      role,
      1,
    ).run();
    row = await database
      .prepare("SELECT * FROM npd_users WHERE lower(email)=lower(?)")
      .bind(normalizedEmail)
      .first<Row>();
  }
  if (!row) throw new Error("用户初始化失败。");
  if (normalizedAuthUserId && !row.auth_user_id) {
    await database.prepare(`UPDATE npd_users SET auth_user_id=?,version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND auth_user_id IS NULL`).bind(normalizedAuthUserId, String(row.id)).run();
    row = await database.prepare("SELECT * FROM npd_users WHERE id=?")
      .bind(String(row.id)).first<Row>();
  }
  if (!row) throw new Error("用户绑定失败。");
  if (!Boolean(row.active)) throw new Error("当前账号已停用，请联系管理员。");
  return mapUser(row);
}

export async function resolveNpdLocalUser(userId: string | null): Promise<NpdUser | null> {
  await ensureNpdDatabase();
  if (!userId) return null;
  const row = await getDatabase().prepare("SELECT * FROM npd_users WHERE id=? AND active=1")
    .bind(userId).first<Row>();
  return row ? mapUser(row) : null;
}

export async function listNpdLocalLoginUsers(): Promise<NpdUser[]> {
  await ensureNpdDatabase();
  const rows = await getDatabase().prepare(`SELECT * FROM npd_users WHERE active=1
    ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, name`).all<Row>();
  return rows.results.map(mapUser);
}

export async function getNpdLocalAuthState() {
  await ensureNpdDatabase();
  const row = await getDatabase().prepare(`SELECT COUNT(*) AS count FROM npd_users
    WHERE password_hash IS NOT NULL AND trim(password_hash)!=''`)
    .first<{ count: number }>();
  const initialized = await getDatabase().prepare(
    "SELECT id FROM npd_activities WHERE id='npd-local-admin-initialized'",
  ).first<Row>();
  return { configured: Boolean(row?.count || initialized) };
}

export async function setupNpdLocalAdmin(input: {
  email: string; name: string; department: string; password: string;
}) {
  await ensureNpdDatabase();
  const database = getDatabase();
  if ((await getNpdLocalAuthState()).configured) throw new Error("本地管理员已初始化，请直接登录。");
  await reserveLocalLoginAttempt(database, input.email, true);
  const email = normalizeEmail(input.email);
  if (!isValidAccountEmail(email) || !input.name.trim() || !input.department.trim()) {
    throw new Error("请填写管理员姓名、部门和有效登录邮箱。");
  }
  assertValidPassword(input.password);
  const conflict = await database.prepare(`SELECT id FROM npd_users
    WHERE lower(email)=lower(?) AND id<>'npd-u-admin'`).bind(email).first<Row>();
  if (conflict) throw new Error("该邮箱已被其他账户占用，请更换邮箱。");
  const credentials = await createPasswordCredentials(input.password);
  const target = await database.prepare(`SELECT id FROM npd_users WHERE id='npd-u-admin'
    UNION ALL SELECT id FROM npd_users WHERE role='admin' LIMIT 1`).first<Row>();
  const userId = target ? String(target.id) : makeId("user");
  const statements: D1PreparedStatement[] = [];
  if (target) {
    statements.push(database.prepare(`UPDATE npd_users SET email=?,name=?,department=?,role='admin',
      active=1,bootstrap_admin=1,password_salt=?,password_hash=?,version=version+1,updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).bind(email, input.name.trim(), input.department.trim(),
        credentials.salt, credentials.hash, userId));
  } else {
    statements.push(database.prepare(`INSERT INTO npd_users (
      id,email,name,department,role,active,bootstrap_admin,password_salt,password_hash
    ) VALUES (?,?,?,?,'admin',1,1,?,?)`).bind(
      userId, email, input.name.trim(), input.department.trim(), credentials.salt, credentials.hash,
    ));
  }
  // The fixed primary key and account mutation commit together. Concurrent
  // setup requests cannot overwrite the winning administrator's credentials.
  statements.push(database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES ('npd-local-admin-initialized',NULL,?,'初始化本地管理员','user',?,?)`)
    .bind(userId, userId, `${input.name.trim()} 已完成首次部署管理员账户初始化。`));
  try {
    await database.batch(statements);
  } catch (error) {
    if ((await getNpdLocalAuthState()).configured) throw new Error("本地管理员已初始化，请直接登录。");
    throw error;
  }
  return createNpdLocalSession(database, userId, { email, salt: credentials.salt, hash: credentials.hash });
}

export async function authenticateNpdLocalUser(emailValue: string, password: string) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const email = normalizeEmail(emailValue);
  await reserveLocalLoginAttempt(database, email);
  const invalidLogin = "邮箱或密码不正确，或账户尚未开通/已停用。";
  try { assertValidPassword(password); } catch { throw new Error(invalidLogin); }
  const row = await database.prepare(`SELECT * FROM npd_users
    WHERE lower(email)=lower(?) AND active=1`).bind(email).first<Row>();
  // Unknown and disabled accounts still do the same password work; do not make
  // their existence obvious through a skipped hash or a different error.
  const credentials = await createPasswordCredentials(password, row?.password_salt ? String(row.password_salt) : "0".repeat(32));
  if (!row || !row.password_salt || !row.password_hash || !constantTimeEqual(credentials.hash, String(row.password_hash))) {
    throw new Error(invalidLogin);
  }
  return createNpdLocalSession(database, String(row.id), {
    email, salt: String(row.password_salt), hash: String(row.password_hash),
  }, true);
}

export async function resolveNpdLocalSession(token: string | null): Promise<NpdUser | null> {
  await ensureNpdDatabase();
  if (!token) return null;
  const database = getDatabase();
  const tokenHash = await sha256Hex(token);
  const row = await database.prepare(`SELECT u.* FROM npd_local_sessions s
    JOIN npd_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP AND u.active=1`).bind(tokenHash).first<Row>();
  return row ? mapUser(row) : null;
}

export async function endNpdLocalSession(token: string | null) {
  await ensureNpdDatabase();
  if (!token) return;
  const database = getDatabase();
  const tokenHash = await sha256Hex(token);
  const session = await database.prepare("SELECT id,user_id FROM npd_local_sessions WHERE token_hash=?")
    .bind(tokenHash).first<Row>();
  if (!session) return;
  await database.batch([
    database.prepare("DELETE FROM npd_local_sessions WHERE token_hash=?").bind(tokenHash),
    database.prepare(`INSERT INTO npd_activities
      (id,project_id,actor_id,action,entity_type,entity_id,detail)
      VALUES (?,NULL,?,'退出本地系统','session',?,'用户主动退出，登录会话已注销。')`)
      .bind(makeId("activity"), String(session.user_id), String(session.id)),
  ]);
}

async function createNpdLocalSession(database: D1Database, userId: string,
  expected: { email: string; salt: string; hash: string }, recordLogin = false) {
  const token = randomHex(32);
  const expiresAt = sqliteTimestamp(new Date(Date.now() + 8 * 60 * 60 * 1000));
  const statements = [
    database.prepare("DELETE FROM npd_local_sessions WHERE expires_at<=CURRENT_TIMESTAMP"),
    database.prepare(`INSERT INTO npd_local_sessions (id,user_id,token_hash,expires_at)
      VALUES (?,CASE WHEN EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1
        AND lower(email)=lower(?) AND password_salt=? AND password_hash=?) THEN ? ELSE NULL END,?,?)`)
      .bind(makeId("session"), userId, expected.email, expected.salt, expected.hash, userId, await sha256Hex(token), expiresAt),
  ];
  if (recordLogin) statements.push(
    database.prepare("UPDATE npd_users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(userId),
    database.prepare(`INSERT INTO npd_activities(id,project_id,actor_id,action,entity_type,entity_id,detail)
      VALUES (?,NULL,?,'登录本地系统','session',NULL,'已使用账户密码登录本地新品开发系统。')`).bind(makeId("activity"), userId),
  );
  try { await database.batch(statements); }
  catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_local_sessions.user_id")) {
      throw new Error("账户在登录期间发生变更，请使用最新账户信息重新登录。");
    }
    throw error;
  }
  const row = await database.prepare("SELECT * FROM npd_users WHERE id=?").bind(userId).first<Row>();
  if (!row) throw new Error("登录账户不存在。");
  return { user: mapUser(row), token, maxAge: 8 * 60 * 60 };
}

export async function getNpdWorkspaceSnapshot(
  currentUser: NpdUser,
): Promise<NpdWorkspaceSnapshot> {
  await ensureNpdDatabase();
  const database = getDatabase();
  const [
    projectResult,
    orderResult,
    customerResult,
    userResult,
    memberResult,
    motorResult,
    sheetResult,
    revisionResult,
    formResult,
    partResult,
    testResult,
    inspectionResult,
    documentResult,
    activityResult,
    preferenceResult,
  ] = await database.batch<Row>([
    database.prepare(`SELECT p.*, c.name AS customer_name,
      initiator.name AS initiator_name, owner.name AS owner_name
      FROM npd_projects p
      JOIN npd_customers c ON c.id=p.customer_id
      JOIN npd_users initiator ON initiator.id=p.initiator_id
      JOIN npd_users owner ON owner.id=p.owner_id
      ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1
        WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
        p.updated_at DESC`),
    database.prepare(`SELECT o.*, c.name AS customer_name, p.code AS project_code,
      u.name AS created_by_name FROM npd_sales_orders o
      JOIN npd_customers c ON c.id=o.customer_id
      LEFT JOIN npd_projects p ON p.id=o.project_id
      JOIN npd_users u ON u.id=o.created_by
      ORDER BY o.order_date DESC, o.order_no DESC`),
    database.prepare("SELECT * FROM npd_customers ORDER BY name"),
    database.prepare("SELECT * FROM npd_users ORDER BY active DESC, role, name"),
    database.prepare(`SELECT m.*, u.name AS user_name, u.role AS user_role
      FROM npd_project_members m JOIN npd_users u ON u.id=m.user_id
      ORDER BY m.created_at`),
    database.prepare("SELECT m.*,u.name AS confirmed_by_name FROM npd_project_motors m LEFT JOIN npd_users u ON u.id=m.confirmed_by ORDER BY m.project_id,m.model"),
    database.prepare(`SELECT s.*, u.name AS updated_by_name
      FROM npd_project_sheets s LEFT JOIN npd_users u ON u.id=s.updated_by
      ORDER BY s.project_id, s.sort_order`),
    // Lists need metadata only. Full historical business snapshots are loaded
    // by the authorized detail/archive paths, not on every workspace refresh.
    database.prepare(`SELECT r.id,r.project_id,r.sheet_code,r.version,r.action,r.summary,r.reason,
      r.status,r.progress,r.planned_date,r.actor_id,r.created_at,u.name AS actor_name
      FROM npd_sheet_revisions r JOIN npd_users u ON u.id=r.actor_id
      ORDER BY r.project_id,r.sheet_code,r.version DESC`),
    database.prepare(`SELECT f.*, u.name AS updated_by_name
      FROM npd_form_records f LEFT JOIN npd_users u ON u.id=f.updated_by
      ORDER BY f.project_id, f.sheet_code, f.form_code`),
    database.prepare(`SELECT p.*, m.model AS motor_model, u.name AS confirmed_by_name
      FROM npd_part_items p
      LEFT JOIN npd_project_motors m ON m.id=p.motor_id
      LEFT JOIN npd_users u ON u.id=p.confirmed_by
      ORDER BY p.project_id, p.planned_date, p.part_no`),
    database.prepare(`SELECT t.*, m.model AS motor_model, u.name AS submitted_by_name,
      d.file_name AS file_name
      FROM npd_test_reports t
      JOIN npd_project_motors m ON m.id=t.motor_id
      JOIN npd_users u ON u.id=t.submitted_by
      LEFT JOIN npd_documents d ON d.id=t.document_id
      ORDER BY t.created_at DESC,t.rowid DESC`),
    database.prepare(`SELECT i.*, m.model AS motor_model, p.name AS part_name,
      u.name AS inspector_name, d.file_name AS file_name
      FROM npd_inspection_records i
      LEFT JOIN npd_project_motors m ON m.id=i.motor_id
      LEFT JOIN npd_part_items p ON p.id=i.part_item_id
      JOIN npd_users u ON u.id=i.inspector_id
      LEFT JOIN npd_documents d ON d.id=i.document_id
      ORDER BY i.created_at DESC,i.rowid DESC`),
    database.prepare(`SELECT d.*, u.name AS uploaded_by_name
      FROM npd_documents d LEFT JOIN npd_users u ON u.id=d.uploaded_by
      ORDER BY d.created_at DESC`),
    database.prepare(`SELECT a.*, p.code AS project_code, u.name AS actor_name
      FROM npd_activities a
      LEFT JOIN npd_projects p ON p.id=a.project_id
      JOIN npd_users u ON u.id=a.actor_id
      JOIN npd_users viewer ON viewer.id=? AND viewer.active=1
      WHERE viewer.role='admin'
        OR (a.project_id IS NOT NULL AND (p.initiator_id=viewer.id OR p.owner_id=viewer.id
          OR EXISTS(SELECT 1 FROM npd_project_members membership
            WHERE membership.project_id=a.project_id AND membership.user_id=viewer.id)))
        OR (a.project_id IS NULL AND (a.actor_id=viewer.id
          OR (a.entity_type='user' AND a.entity_id=viewer.id)))
      ORDER BY a.created_at DESC,a.rowid DESC LIMIT 300`).bind(currentUser.id),
    database.prepare("SELECT payload FROM npd_dashboard_preferences WHERE user_id=?")
      .bind(currentUser.id),
  ]);

  // Identity, membership and data must come from the same read transaction.
  // Never authorize this snapshot with a role cached before the batch began.
  const currentUserRow = userResult.results.find((row) => row.id === currentUser.id);
  if (!currentUserRow) throw new Error("登录账户不存在或无权访问。");
  currentUser = mapUser(currentUserRow);
  assertActive(currentUser);
  const preferenceRow = preferenceResult.results[0];
  const members = memberResult.results.map(mapMember);
  const allProjects = projectResult.results.map(mapProjectBase);
  const visibleProjects = allProjects.filter((project) =>
    canSeeProject(currentUser, project, members),
  );
  const visibleIds = new Set(visibleProjects.map((project) => project.id));
  const orders = orderResult.results.map(mapOrder).filter((order) =>
    currentUser.role === "admin" || currentUser.role === "sales" ||
    Boolean(order.projectId && visibleIds.has(order.projectId)),
  );
  const motors = motorResult.results.map(mapMotor).filter((row) => visibleIds.has(row.projectId));
  const sheets = sheetResult.results.map(mapSheet).filter((row) => visibleIds.has(row.projectId));
  const forms = formResult.results.map(mapForm).filter((row) => visibleIds.has(row.projectId));
  const projects = visibleProjects.map((project) => {
    const projectMotors = motors.filter((motor) => motor.projectId === project.id);
    const projectSheets = sheets.filter((sheet) => sheet.projectId === project.id);
    const currentSheet = projectSheets.find((sheet) => sheet.code === project.currentSheetCode);
    return {
      ...project,
      motorCount: projectMotors.length,
      currentSheetTitle: currentSheet?.title || sheetByCode[project.currentSheetCode].title,
      overdueDays: projectOverdueDays(project),
    };
  });

  let dashboardPreference = defaultDashboardPreference();
  if (preferenceRow?.payload) {
    try {
      dashboardPreference = readDashboardPreference(JSON.parse(String(preferenceRow.payload)));
    } catch {
      dashboardPreference = defaultDashboardPreference();
    }
  }

  return {
    projects,
    customers: customerResult.results.map(mapCustomer),
    orders,
    users: userResult.results.map(mapUser),
    members: members.filter((row) => visibleIds.has(row.projectId)),
    motors,
    sheets,
    sheetRevisions: revisionResult.results.map(mapSheetRevision)
      .filter((row) => visibleIds.has(row.projectId)),
    formRecords: forms,
    parts: partResult.results.map(mapPart).filter((row) => visibleIds.has(row.projectId)),
    testReports: testResult.results.map(mapTestReport).filter((row) => visibleIds.has(row.projectId)),
    inspections: inspectionResult.results.map(mapInspection).filter((row) => visibleIds.has(row.projectId)),
    documents: documentResult.results.map(mapDocument).filter((row) => visibleIds.has(row.projectId)),
    activities: activityResult.results.map(mapActivity).filter(
      // The SQL scopes before LIMIT using the same transaction's current user;
      // retain this guard so future joins cannot broaden the returned audience.
      (row) => row.projectId ? visibleIds.has(row.projectId) : currentUser.role === "admin"
        || row.actorId === currentUser.id || (row.entityType === "user" && row.entityId === currentUser.id),
    ),
    dashboardPreference,
  };
}

function mapUser(row: Row): NpdUser {
  const role = normalizeRole(row.role);
  const name = String(row.name || "未命名用户");
  return {
    id: String(row.id), email: String(row.email), name,
    department: String(row.department || "未分配部门"), role,
    roleLabel: roleLabels[role], active: Boolean(row.active),
    avatar: initials(name),
    version: Number(row.version),
    createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
  };
}

function mapCustomer(row: Row): NpdCustomer {
  return {
    id: String(row.id), code: String(row.code), name: String(row.name),
    industry: String(row.industry), contact: String(row.contact || ""),
    phone: String(row.phone || ""),
  };
}

function mapOrder(row: Row): NpdSalesOrder {
  return {
    version: Number(row.version),
    id: String(row.id), orderNo: String(row.order_no), customerId: String(row.customer_id),
    customerName: String(row.customer_name || ""),
    projectId: row.project_id ? String(row.project_id) : null,
    projectCode: String(row.project_code || ""), productSummary: String(row.product_summary),
    quantity: Number(row.quantity || 1), amount: Number(row.amount || 0),
    currency: String(row.currency || "CNY"), orderDate: String(row.order_date),
    deliveryDate: String(row.delivery_date), status: String(row.status),
    createdBy: String(row.created_by), createdByName: String(row.created_by_name || ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapProjectBase(row: Row): NpdProject {
  const currentSheetCode = String(row.current_sheet_code) as SheetCode;
  return {
    id: String(row.id), code: String(row.code), name: String(row.name),
    seriesName: String(row.series_name), category: String(row.category),
    source: String(row.source), customerId: String(row.customer_id),
    customerName: String(row.customer_name || ""), initiatorId: String(row.initiator_id),
    initiatorName: String(row.initiator_name || ""), ownerId: String(row.owner_id),
    ownerName: String(row.owner_name || ""), status: String(row.status) as ProjectStatus,
    lifecycleVersion: Number(row.lifecycle_version),
    ownershipVersion: Number(row.ownership_version),
    riskLevel: String(row.risk_level) as RiskLevel, currentSheetCode,
    currentSheetTitle: sheetByCode[currentSheetCode]?.title || "阶段未配置",
    progress: Number(row.progress || 0), plannedStart: String(row.planned_start),
    plannedEnd: String(row.planned_end), actualEnd: row.actual_end ? String(row.actual_end) : null,
    priority: String(row.priority), description: String(row.description || ""),
    motorCount: 0, overdueDays: 0, createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMember(row: Row): ProjectMember {
  const role = normalizeRole(row.user_role);
  return {
    version: Number(row.version),
    id: String(row.id), projectId: String(row.project_id), userId: String(row.user_id),
    userName: String(row.user_name || ""), role, roleLabel: roleLabels[role],
    responsibility: String(row.responsibility), createdAt: String(row.created_at),
  };
}

function mapMotor(row: Row): ProjectMotor {
  return {
    id: String(row.id), projectId: String(row.project_id), model: String(row.model),
    ratedPower: String(row.rated_power || ""),
    voltage: String(row.voltage || ""), frequency: String(row.frequency || ""),
    poles: String(row.poles || ""), speed: String(row.speed || ""),
    frameSize: String(row.frame_size || ""), mounting: String(row.mounting || ""),
    terminalMode: String(row.terminal_mode || ""),
    protectionGrade: String(row.protection_grade || ""),
    insulationClass: String(row.insulation_class || ""),
    coolingMethod: String(row.cooling_method || ""),
    quantity: Number(row.quantity || 1), designRevision: Number(row.design_revision || 1),
    inspectionRequirement: String(row.inspection_requirement || ""),
    testRequirement: String(row.test_requirement || ""), plannedDate: String(row.planned_date),
    actualDate: row.actual_date ? String(row.actual_date) : null, status: String(row.status),
    confirmedBy: row.confirmed_by ? String(row.confirmed_by) : null,
    confirmedByName: row.confirmed_by_name ? String(row.confirmed_by_name) : null,
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    productionNote: String(row.production_note || ""),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapSheetRevision(row: Row): SheetRevision {
  return {
    id: String(row.id), projectId: String(row.project_id),
    sheetCode: String(row.sheet_code) as SheetCode, version: Number(row.version || 1),
    action: String(row.action), summary: String(row.summary), reason: String(row.reason || ""),
    status: String(row.status) as SheetStatus, progress: Number(row.progress || 0),
    plannedDate: String(row.planned_date), actorId: String(row.actor_id),
    actorName: String(row.actor_name || ""), createdAt: String(row.created_at),
  };
}

function mapSheet(row: Row): ProjectSheet {
  const role = normalizeRole(row.owner_role);
  return {
    id: String(row.id), projectId: String(row.project_id), code: String(row.code) as SheetCode,
    title: String(row.title), sortOrder: Number(row.sort_order), ownerRole: role,
    ownerRoleLabel: roleLabels[role], status: String(row.status) as SheetStatus,
    progress: Number(row.progress || 0), plannedDate: String(row.planned_date),
    actualDate: row.actual_date ? String(row.actual_date) : null,
    version: Number(row.version || 1), note: String(row.note || ""),
    updatedBy: String(row.updated_by), updatedByName: String(row.updated_by_name || ""),
    updatedAt: String(row.updated_at),
  };
}

function mapForm(row: Row): NpdFormRecord {
  let payload: Record<string, string | number | boolean> = {};
  try { payload = JSON.parse(String(row.payload || "{}")); } catch { payload = {}; }
  return {
    id: String(row.id), projectId: String(row.project_id), formCode: String(row.form_code),
    sheetCode: String(row.sheet_code) as SheetCode,
    status: String(row.status) === "submitted" ? "submitted" : "draft",
    version: Number(row.version || 1), payload, updatedBy: String(row.updated_by),
    updatedByName: String(row.updated_by_name || ""), updatedAt: String(row.updated_at),
  };
}

function mapPart(row: Row): PartItem {
  return {
    id: String(row.id), projectId: String(row.project_id),
    motorId: row.motor_id ? String(row.motor_id) : null,
    motorModel: String(row.motor_model || "系列通用"), partNo: String(row.part_no),
    name: String(row.name), specification: String(row.specification || ""),
    material: String(row.material || ""), quantity: Number(row.quantity || 1),
    sourceType: String(row.source_type), designOutputRef: String(row.design_output_ref || ""),
    inspectionRequirement: String(row.inspection_requirement || ""),
    testRequirement: String(row.test_requirement || ""), plannedDate: String(row.planned_date),
    actualDate: row.actual_date ? String(row.actual_date) : null, status: String(row.status),
    confirmedBy: row.confirmed_by ? String(row.confirmed_by) : null,
    confirmedByName: String(row.confirmed_by_name || ""),
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
    designRevision: Number(row.design_revision || 1),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapTestReport(row: Row): TestReport {
  return {
    id: String(row.id), projectId: String(row.project_id), motorId: String(row.motor_id),
    motorModel: String(row.motor_model), reportNo: String(row.report_no),
    reportType: String(row.report_type), title: String(row.title),
    requirementRef: String(row.requirement_ref || ""), testDate: String(row.test_date),
    result: String(row.result), conclusion: String(row.conclusion || ""),
    documentId: row.document_id ? String(row.document_id) : null,
    fileName: String(row.file_name || ""), submittedBy: String(row.submitted_by),
    submittedByName: String(row.submitted_by_name || ""),
    requirementRevision: Number(row.requirement_revision || 1), createdAt: String(row.created_at),
  };
}

function mapInspection(row: Row): InspectionRecord {
  return {
    id: String(row.id), projectId: String(row.project_id),
    motorId: row.motor_id ? String(row.motor_id) : null,
    motorModel: String(row.motor_model || ""),
    partItemId: row.part_item_id ? String(row.part_item_id) : null,
    itemName: String(row.part_name || row.motor_model || "检验对象"),
    itemType: String(row.item_type) === "part" ? "part" : "motor",
    inspectionRequirement: String(row.inspection_requirement),
    designOutputRef: String(row.design_output_ref || ""),
    inspectionDate: String(row.inspection_date), result: String(row.result),
    conclusion: String(row.conclusion || ""),
    documentId: row.document_id ? String(row.document_id) : null,
    fileName: String(row.file_name || ""), inspectorId: String(row.inspector_id),
    inspectorName: String(row.inspector_name || ""),
    requirementRevision: Number(row.requirement_revision || 1), createdAt: String(row.created_at),
  };
}

function mapDocument(row: Row): NpdDocument {
  return {
    id: String(row.id), projectId: String(row.project_id),
    sheetCode: String(row.sheet_code) as SheetCode,
    motorId: row.motor_id ? String(row.motor_id) : null,
    linkedRecordId: row.linked_record_id ? String(row.linked_record_id) : null,
    kind: String(row.kind), fileName: String(row.file_name), objectKey: String(row.object_key),
    contentType: String(row.content_type), size: Number(row.size), version: String(row.version),
    uploadedBy: String(row.uploaded_by), uploadedByName: String(row.uploaded_by_name || ""),
    createdAt: String(row.created_at),
  };
}

function mapActivity(row: Row): NpdActivity {
  return {
    id: String(row.id), projectId: row.project_id ? String(row.project_id) : null,
    projectCode: String(row.project_code || "系统"), actorId: String(row.actor_id),
    actorName: String(row.actor_name || ""), action: String(row.action),
    entityType: String(row.entity_type), entityId: row.entity_id ? String(row.entity_id) : null,
    detail: String(row.detail), createdAt: String(row.created_at),
  };
}

export interface CreateNpdProjectInput {
  name: string;
  seriesName: string;
  category: string;
  source: string;
  customerId: string;
  ownerId: string;
  processId: string;
  procurementId: string;
  productionId: string;
  testerId: string;
  qualityId: string;
  plannedStart: string;
  plannedEnd: string;
  priority: string;
  riskLevel: RiskLevel;
  description: string;
  orderIds?: string[];
  orderVersions?: Record<string, number>;
  motors: Array<{
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
    inspectionRequirement: string;
    testRequirement: string;
    plannedDate: string;
  }>;
}

export async function createNpdProject(
  input: CreateNpdProjectInput,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  if (!canCreateProject(currentUser.role)) {
    throw new Error("只有销售、设计和管理员可以创建新项目。");
  }
  if (
    !input.name?.trim() || !input.seriesName?.trim() || !input.customerId ||
    !input.ownerId || !validDate(input.plannedStart) || !validDate(input.plannedEnd) ||
    input.plannedEnd < input.plannedStart
  ) {
    throw new Error("项目名称、系列、客户、负责人和有效计划日期均为必填项。");
  }
  if (!input.motors?.length) throw new Error("项目至少需要包含一个具体电机规格。");
  const models = input.motors.map((motor) => motor.model?.trim().toLowerCase()).filter(Boolean);
  if (models.length !== input.motors.length || new Set(models).size !== models.length) {
    throw new Error("每个电机规格必须填写唯一型号。");
  }
  if (input.motors.some((motor) => !Number.isSafeInteger(motor.quantity) || motor.quantity < 1)) {
    throw new Error("电机数量必须为正整数。");
  }
  const database = getDatabase();
  const users = await database
    .prepare("SELECT * FROM npd_users WHERE active=1")
    .all<Row>();
  const owner = users.results.map(mapUser).find((user) => user.id === input.ownerId);
  if (!owner || !assignableOwner(owner)) {
    throw new Error("项目负责人必须是有效的销售、设计或管理员。");
  }
  const requiredAssignments: Array<[string, NpdRole, string]> = [
    [input.processId, "process", "工艺方案、工装及可制造性确认"],
    [input.procurementId, "procurement", "外购外协件询价、供应商与到料节点"],
    [input.productionId, "production", "整机及零部件节点确认"],
    [input.testerId, "tester", "型式试验与验证报告"],
    [input.qualityId, "quality", "零部件及整机质量检验"],
  ];
  for (const [userId, role] of requiredAssignments) {
    const assignee = users.results.map(mapUser).find((user) => user.id === userId);
    if (!assignee || assignee.role !== role) {
      throw new Error(`请为项目指定有效的${roleLabels[role]}人员。`);
    }
  }
  const orderIds = [...new Set((input.orderIds || []).filter(Boolean))];
  if (orderIds.length) {
    const placeholders = orderIds.map(() => "?").join(",");
    const linkedOrders = await database.prepare(`SELECT id,customer_id,project_id,version
      FROM npd_sales_orders WHERE id IN (${placeholders})`).bind(...orderIds).all<Row>();
    if (linkedOrders.results.length !== orderIds.length) throw new Error("关联订单不存在。");
    if (linkedOrders.results.some((order) => order.project_id)) {
      throw new Error("所选订单中存在已关联项目的订单。");
    }
    if (linkedOrders.results.some((order) => order.customer_id !== input.customerId)) {
      throw new Error("销售订单客户必须与项目客户一致。");
    }
    for (const order of linkedOrders.results) {
      assertExpectedVersion(input.orderVersions?.[String(order.id)], Number(order.version));
    }
  }

  const id = makeId("project");
  const codePrefix = `NP-${new Date().getFullYear()}-`;
  const assignments = JSON.stringify(requiredAssignments.map(([userId, role]) => ({ userId, role })));
  const initialSnapshotSql = await snapshotExpression(database);
  const statements: D1PreparedStatement[] = [
    database.prepare(`INSERT INTO npd_projects (
      id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,
      status,risk_level,current_sheet_code,progress,planned_start,planned_end,
      priority,description
    ) VALUES (?,(SELECT ? || printf('%03d',COALESCE(MAX(CAST(substr(code,9) AS INTEGER)),0)+1)
      FROM npd_projects WHERE code LIKE ?),
      CASE WHEN EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role=? AND role IN ('admin','sales','design'))
      AND EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role IN ('admin','sales','design'))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN npd_users u ON u.id=json_extract(e.value,'$.userId')
        WHERE u.id IS NULL OR u.active<>1 OR u.role<>json_extract(e.value,'$.role'))
      AND NOT EXISTS(SELECT 1 FROM json_each(?) e LEFT JOIN npd_sales_orders o ON o.id=json_extract(e.value,'$.id')
        WHERE o.id IS NULL OR o.project_id IS NOT NULL OR o.customer_id<>? OR o.version<>json_extract(e.value,'$.version'))
      THEN ? ELSE NULL END,?,?,?,?,?,?,'active',?,'initiation',0,?,?,?,?)`).bind(
      id, codePrefix, `${codePrefix}%`, currentUser.id, currentUser.role, input.ownerId,
      assignments, JSON.stringify(orderIds.map((orderId) => ({ id: orderId, version: input.orderVersions?.[orderId] }))), input.customerId,
      input.name.trim(), input.seriesName.trim(), input.category,
      input.source, input.customerId, currentUser.id, input.ownerId,
      input.riskLevel, input.plannedStart, input.plannedEnd, input.priority,
      input.description?.trim() || "",
    ),
  ];

  const memberMap = new Map<string, string>([
    [currentUser.id, "项目发起与需求管理"],
    [input.ownerId, "项目总负责人与全流程数据维护"],
    ...requiredAssignments.map(([userId, , responsibility]) => [userId, responsibility] as [string, string]),
  ]);
  memberMap.forEach((responsibility, userId) => statements.push(
    database.prepare(`INSERT INTO npd_project_members
      (id,project_id,user_id,responsibility) VALUES (?,?,?,?)`).bind(
      makeId("member"), id, userId, responsibility,
    ),
  ));

  input.motors.forEach((motor) => statements.push(
    database.prepare(`INSERT INTO npd_project_motors (
      id,project_id,model,motor_code,rated_power,voltage,frequency,poles,speed,
      frame_size,mounting,terminal_mode,protection_grade,insulation_class,cooling_method,
      quantity,inspection_requirement,test_requirement,planned_date,status
    ) VALUES (?,?,?,'',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned')`).bind(
      makeId("motor"), id, motor.model.trim(),
      motor.ratedPower?.trim() || "", motor.voltage?.trim() || "",
      motor.frequency?.trim() || "50Hz", motor.poles?.trim() || "",
      motor.speed?.trim() || "", motor.frameSize?.trim() || "",
      motor.mounting?.trim() || "", motor.terminalMode?.trim() || "",
      motor.protectionGrade?.trim() || "", motor.insulationClass?.trim() || "",
      motor.coolingMethod?.trim() || "", Math.max(1, Number(motor.quantity || 1)),
      motor.inspectionRequirement?.trim() || "", motor.testRequirement?.trim() || "",
      validDate(motor.plannedDate) ? motor.plannedDate : input.plannedEnd,
    ),
  ));

  sheetDefinitions.forEach((sheet, index) => statements.push(
    database.prepare(`INSERT INTO npd_project_sheets (
      id,project_id,code,title,sort_order,owner_role,status,progress,planned_date,
      version,note,updated_by
    ) VALUES (?,?,?,?,?,?,'not_started',0,?,1,'',?)`).bind(
      makeId("sheet"), id, sheet.code, sheet.title, sheet.index, sheet.ownerRole,
      interpolateDate(input.plannedStart, input.plannedEnd, sheetScheduleRatios[index]),
      currentUser.id,
    ),
  ));
  sheetDefinitions.forEach((sheet, index) => statements.push(
    database.prepare(`INSERT INTO npd_sheet_revisions (
      id,project_id,sheet_code,version,action,summary,reason,status,progress,
      planned_date,actor_id,snapshot
    ) VALUES (?,?,?,1,'创建阶段','项目创建时自动生成阶段 Sheet','首次创建',
      'not_started',0,?,?,json_set(?,'$.data',${initialSnapshotSql}))`).bind(
      makeId("revision"), id, sheet.code,
      interpolateDate(input.plannedStart, input.plannedEnd, sheetScheduleRatios[index]),
      currentUser.id, JSON.stringify({ source: "project_creation" }),
      id, id, id, id, id, id,
    ),
  ));
  orderIds.forEach((orderId) => statements.push(
    database.prepare(`UPDATE npd_sales_orders SET project_id=?,status='in_development',
      version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id IS NULL`).bind(id, orderId),
  ));
  statements.push(database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,?,?,?,?,(SELECT code FROM npd_projects WHERE id=?) || ?)`).bind(
    makeId("activity"), id, currentUser.id, "创建项目", "project", id,
    id, ` 已由 ${currentUser.name} 发起，项目负责人为 ${owner.name}，包含 ${input.motors.length} 个电机规格。`,
  ));
  try { await database.batch(statements); }
  catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_projects.name")) throw new NpdConflictError();
    throw error;
  }
  const created = await database.prepare("SELECT code FROM npd_projects WHERE id=?").bind(id).first<{ code: string }>();
  return { id, code: created!.code };
}

export async function saveNpdCustomer(input: {
  id?: string; code: string; name: string; industry: string; contact: string; phone: string;
  expected?: NpdCustomer; reason?: string;
}, currentUser: NpdUser) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  if (!["admin", "sales"].includes(currentUser.role)) throw new Error("只有销售和管理员可以维护客户资料。");
  const database = getDatabase();
  const fields = ["code", "name", "industry", "contact", "phone"] as const;
  const value = Object.fromEntries(fields.map((key) => [key, String(input[key] || "").trim()])) as Record<typeof fields[number], string>;
  value.code = value.code.toUpperCase();
  if (!value.code || !value.name || !value.industry) throw new Error("客户编号、客户名称和行业为必填项。");
  if (value.code.length > 64 || fields.some((key) => value[key].length > 200)) throw new Error("客户编号最多64字，其他客户资料字段最多200字。");
  const existing = input.id ? await database.prepare("SELECT * FROM npd_customers WHERE id=?").bind(input.id).first<Row>() : null;
  if (input.id && !existing) throw new Error("客户不存在。");
  if (existing && (!input.expected || fields.some((key) => input.expected![key] !== existing[key]))) throw new NpdConflictError();
  if (existing && !input.reason?.trim()) throw new Error("请填写客户资料变更原因。");
  const duplicate = await database.prepare("SELECT id FROM npd_customers WHERE lower(code)=lower(?) AND id<>?")
    .bind(value.code, input.id || "").first<Row>();
  if (duplicate) throw new Error("客户编号已存在，请维护现有客户或使用其他编号。");
  const id = input.id || makeId("customer");
  const changes = existing ? fields.filter((key) => value[key] !== existing[key]) : fields;
  if (existing && !changes.length) throw new Error("客户资料没有变化，无需重复保存。");
  const oldCondition = existing ? `AND EXISTS(SELECT 1 FROM npd_customers WHERE id=? AND ${fields.map((key) => `${key}=?`).join(" AND ")})` : "";
  const audit = database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,NULL,CASE WHEN EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role=? AND role IN ('admin','sales'))
      AND NOT EXISTS(SELECT 1 FROM npd_customers WHERE lower(code)=lower(?) AND id<>?) ${oldCondition}
      THEN ? ELSE NULL END,?,'customer',?,?)`)
    .bind(makeId("activity"), currentUser.id, currentUser.role, value.code, id,
      ...(existing ? [id, ...fields.map((key) => String(existing[key]))] : []), currentUser.id,
      existing ? "修改客户资料" : "新增客户", id, JSON.stringify({ code: value.code, name: value.name,
        reason: input.reason?.trim() || "首次录入", changes: changes.map((key) => ({ field: key, before: existing?.[key] ?? null, after: value[key] })) }));
  const mutation = existing
    ? database.prepare("UPDATE npd_customers SET code=?,name=?,industry=?,contact=?,phone=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(...fields.map((key) => value[key]), id)
    : database.prepare("INSERT INTO npd_customers (id,code,name,industry,contact,phone) VALUES (?,?,?,?,?,?)").bind(id, ...fields.map((key) => value[key]));
  try { await database.batch([audit, mutation]); }
  catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_activities.actor_id")) throw new NpdConflictError();
    throw error;
  }
  return { id, ...value };
}

export async function createNpdSalesOrder(
  input: {
    orderNo: string; customerId: string; productSummary: string; quantity: number;
    amount: number; currency: string; orderDate: string; deliveryDate: string;
  },
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  if (currentUser.role !== "admin" && currentUser.role !== "sales") {
    throw new Error("只有销售或管理员可以录入销售订单。");
  }
  if (!input.orderNo?.trim() || !input.customerId || !input.productSummary?.trim() ||
      !validDate(input.orderDate) || !validDate(input.deliveryDate) ||
      input.deliveryDate < input.orderDate) {
    throw new Error("订单号、客户、产品概要和有效订单/交付日期均为必填项。");
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new Error("订单数量必须为正整数。");
  if (!Number.isFinite(input.amount) || input.amount < 0 || !Number.isSafeInteger(Math.round(input.amount * 100)) ||
      Math.abs(input.amount * 100 - Math.round(input.amount * 100)) > 0.000001) {
    throw new Error("订单金额必须为非负有效数值，最多保留两位小数。");
  }
  if (!["CNY", "USD", "EUR"].includes(input.currency)) throw new Error("不支持该订单币种，请选择 CNY、USD 或 EUR。");
  const database = getDatabase();
  const customer = await database.prepare("SELECT id FROM npd_customers WHERE id=?")
    .bind(input.customerId).first<Row>();
  if (!customer) throw new Error("订单客户不存在。");
  const duplicate = await database.prepare("SELECT id FROM npd_sales_orders WHERE lower(order_no)=lower(?)")
    .bind(input.orderNo.trim()).first<Row>();
  if (duplicate) throw new Error("订单号已存在。");
  const id = makeId("order");
  const mutation = database.prepare(`INSERT INTO npd_sales_orders (
    id,order_no,customer_id,project_id,product_summary,quantity,amount,currency,
    order_date,delivery_date,status,created_by
  ) VALUES (?,?,?,NULL,?,?,?,?,? ,?,'confirmed',?)`).bind(
    id, input.orderNo.trim(), input.customerId, input.productSummary.trim(),
    input.quantity, Math.round(input.amount * 100) / 100,
    input.currency, input.orderDate, input.deliveryDate, currentUser.id,
  );
  const audit = database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,NULL,CASE WHEN EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role=? AND role IN ('admin','sales'))
      AND NOT EXISTS(SELECT 1 FROM npd_sales_orders WHERE lower(order_no)=lower(?))
      THEN ? ELSE NULL END,'录入销售订单','sales_order',?,?)`)
    .bind(makeId("activity"), currentUser.id, currentUser.role, input.orderNo.trim(), currentUser.id, id,
      `${input.orderNo.trim()} 已录入，待关联新品项目。`);
  try { await database.batch([audit, mutation]); }
  catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_activities.actor_id")) throw new NpdConflictError();
    throw error;
  }
  return { id };
}

export async function linkNpdSalesOrder(
  orderId: string,
  projectId: string | null,
  currentUser: NpdUser,
  expectedProjectId: string | null,
  expectedVersion: number,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  const database = getDatabase();
  const order = await database.prepare("SELECT * FROM npd_sales_orders WHERE id=?")
    .bind(orderId).first<Row>();
  if (!order) throw new Error("销售订单不存在。");
  assertExpectedVersion(expectedVersion, Number(order.version));
  if (expectedProjectId !== order.project_id) throw new NpdConflictError();
  if (projectId === order.project_id) throw new Error("订单关联没有变化，无需重复保存。");
  const accessProjectId = projectId || (order.project_id ? String(order.project_id) : null);
  let project: NpdProject | null = null;
  if (accessProjectId) project = (await getEditableProject(accessProjectId, currentUser)).project;
  if (currentUser.role !== "admin" && currentUser.role !== "sales" &&
      (!project || !isProjectSteward(currentUser, project))) {
    throw new Error("只有销售、项目负责人或管理员可以维护订单关联。");
  }
  if (projectId) {
    if (!project || project.customerId !== String(order.customer_id)) {
      throw new Error("销售订单客户必须与项目客户一致。");
    }
    if (order.project_id && order.project_id !== projectId) {
      throw new Error("订单已关联其他项目，请先解除原关联。");
    }
  }
  const mutation = database.prepare(`UPDATE npd_sales_orders SET project_id=?,status=?,
    version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
    projectId, projectId ? "in_development" : "confirmed", orderId,
  );
  const audit = database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,CASE WHEN EXISTS(SELECT 1 FROM npd_sales_orders WHERE id=? AND project_id IS ? AND version=?)
      AND EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role=?)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM npd_projects p WHERE p.id=? AND p.status=? AND p.status<>'paused'
        AND (?='admin' OR p.owner_id=? OR p.initiator_id=? OR EXISTS(
          SELECT 1 FROM npd_project_members m WHERE m.project_id=p.id AND m.user_id=?))
        AND (? IN ('admin','sales') OR p.owner_id=? OR p.initiator_id=?)))
      THEN ? ELSE NULL END,?,'sales_order',?,?)`)
    .bind(makeId("activity"), accessProjectId, orderId, order.project_id, expectedVersion, currentUser.id, currentUser.role,
      accessProjectId, accessProjectId, project?.status || null,
      currentUser.role, currentUser.id, currentUser.id, currentUser.id, currentUser.role, currentUser.id, currentUser.id, currentUser.id,
      projectId ? "关联销售订单" : "解除订单关联", orderId,
      `${String(order.order_no)} ${projectId ? `已关联项目 ${project?.code}` : "已解除项目关联"}；订单版本 V${expectedVersion} → V${expectedVersion + 1}。`);
  try { await database.batch([audit, mutation]); }
  catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_activities.actor_id")) throw new NpdConflictError();
    throw error;
  }
}

export async function addProjectMotor(
  projectId: string,
  input: Omit<CreateNpdProjectInput["motors"][number], "plannedDate"> & { plannedDate: string },
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(projectId, currentUser);
  if (!isProjectSteward(currentUser, project)) {
    throw new Error("只有项目发起人、项目负责人或管理员可以增加电机规格。");
  }
  const context = await loadRevisionContext(database, projectId, project);
  if (!input.model?.trim() || !validDate(input.plannedDate)) {
    throw new Error("电机型号和计划完成日期为必填项。");
  }
  const duplicate = await database.prepare(
    "SELECT id FROM npd_project_motors WHERE project_id=? AND lower(model)=lower(?)",
  ).bind(projectId, input.model.trim()).first<Row>();
  if (duplicate) throw new Error("该项目下已存在同型号电机规格。");
  const id = makeId("motor");
  const mutation = database.prepare(`INSERT INTO npd_project_motors (
    id,project_id,model,motor_code,rated_power,voltage,frequency,poles,speed,
    frame_size,mounting,terminal_mode,protection_grade,insulation_class,cooling_method,
    quantity,inspection_requirement,test_requirement,planned_date,status
  ) VALUES (?,?,?,'',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned')`).bind(
    id, projectId, input.model.trim(),
    input.ratedPower?.trim() || "", input.voltage?.trim() || "",
    input.frequency?.trim() || "50Hz", input.poles?.trim() || "",
    input.speed?.trim() || "", input.frameSize?.trim() || "",
    input.mounting?.trim() || "", input.terminalMode?.trim() || "",
    input.protectionGrade?.trim() || "", input.insulationClass?.trim() || "",
    input.coolingMethod?.trim() || "", Math.max(1, Number(input.quantity || 1)),
    input.inspectionRequirement?.trim() || "", input.testRequirement?.trim() || "",
    input.plannedDate,
  );
  const activity = activityStatement(database, projectId, currentUser.id, "增加电机规格", "motor", id,
    `新增规格 ${input.model.trim()}，计划完成日期 ${input.plannedDate}。`);
  const derived = await designChangeProgress(database, projectId, { motor: {
    id, model: input.model.trim(), design_revision: 1,
    inspection_requirement: input.inspectionRequirement?.trim() || "", test_requirement: input.testRequirement?.trim() || "",
  } });
  await reviseProjectSheet(database, projectId, "input_output", currentUser.id, {
    action: "增加电机规格", summary: `新增规格 ${input.model.trim()}`,
    reason: "项目范围增加", progress: 40, relatedProgress: derived.relatedProgress, snapshot: { motorId: id, designRevision: 1 },
    status: context.sheets.find((sheet) => sheet.code === "input_output")?.status === "completed" ? "pending_review" : "in_progress",
    context, mutations: [mutation, activity], actorRole: currentUser.role,
    guard: { sql: "NOT EXISTS (SELECT 1 FROM npd_project_motors WHERE project_id=? AND lower(model)=lower(?))", values: [projectId, input.model.trim()] },
  }, true);
  return { id };
}

export async function updateProjectMotor(
  motorId: string,
  input: CreateNpdProjectInput["motors"][number] & { changeReason: string; expectedRevision: number },
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const motor = await database.prepare("SELECT * FROM npd_project_motors WHERE id=?")
    .bind(motorId).first<Row>();
  if (!motor) throw new Error("电机规格不存在。");
  const { project } = await getEditableProject(String(motor.project_id), currentUser);
  if (currentUser.role !== "admin" && currentUser.role !== "design" &&
      !isProjectSteward(currentUser, project)) {
    throw new Error("只有设计、项目负责人或管理员可以修改电机规格。");
  }
  const context = await loadRevisionContext(database, String(motor.project_id), project);
  assertExpectedVersion(input.expectedRevision, Number(motor.design_revision || 1));
  if (!input.model?.trim() || !validDate(input.plannedDate) || !input.changeReason?.trim()) {
    throw new Error("电机型号、计划日期和变更原因均为必填项。");
  }
  const duplicate = await database.prepare(`SELECT id FROM npd_project_motors
    WHERE project_id=? AND lower(model)=lower(?) AND id<>?`).bind(
      String(motor.project_id), input.model.trim(), motorId,
    ).first<Row>();
  if (duplicate) throw new Error("该项目下已存在同型号电机规格。");
  const designRevision = Number(motor.design_revision || 1) + 1;
  const mutation = database.prepare(`UPDATE npd_project_motors SET model=?,rated_power=?,voltage=?,
    frequency=?,poles=?,speed=?,frame_size=?,mounting=?,terminal_mode=?,protection_grade=?,
    insulation_class=?,cooling_method=?,quantity=?,inspection_requirement=?,test_requirement=?,
    planned_date=?,design_revision=?,status='planned',actual_date=NULL,confirmed_by=NULL,
    confirmed_at=NULL,production_note='',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
    input.model.trim(), input.ratedPower?.trim() || "", input.voltage?.trim() || "",
    input.frequency?.trim() || "50Hz", input.poles?.trim() || "", input.speed?.trim() || "",
    input.frameSize?.trim() || "", input.mounting?.trim() || "", input.terminalMode?.trim() || "",
    input.protectionGrade?.trim() || "", input.insulationClass?.trim() || "",
    input.coolingMethod?.trim() || "", Math.max(1, Number(input.quantity || 1)),
    input.inspectionRequirement?.trim() || "", input.testRequirement?.trim() || "",
    input.plannedDate, designRevision, motorId,
  );
  const activity = activityStatement(database, String(motor.project_id), currentUser.id, "变更电机规格", "motor", motorId,
    `${String(motor.model)} 更新为 ${input.model.trim()} · 设计版次 R${designRevision}：${input.changeReason.trim()}。`);
  const derived = await designChangeProgress(database, String(motor.project_id), { motor: {
    ...motor, model: input.model.trim(), design_revision: designRevision, status: "planned", actual_date: null, confirmed_by: null, confirmed_at: null,
    inspection_requirement: input.inspectionRequirement?.trim() || "", test_requirement: input.testRequirement?.trim() || "",
  } });
  await reviseProjectSheet(database, String(motor.project_id), "input_output", currentUser.id, {
    action: "变更电机规格", summary: `${input.model.trim()} 升级至设计版次 R${designRevision}`,
    relatedProgress: derived.relatedProgress,
    reason: input.changeReason, snapshot: { motorId, previousRevision: motor.design_revision, designRevision, before: motor },
    context, mutations: [mutation, activity], actorRole: currentUser.role,
    guard: { sql: "EXISTS (SELECT 1 FROM npd_project_motors WHERE id=? AND design_revision=?)", values: [motorId, input.expectedRevision] },
  }, true);
}

export async function updateMotorRequirements(
  motorId: string,
  inspectionRequirement: string,
  testRequirement: string,
  currentUser: NpdUser,
  expectedRevision: number,
) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const motor = await database.prepare("SELECT * FROM npd_project_motors WHERE id=?")
    .bind(motorId).first<Row>();
  if (!motor) throw new Error("电机规格不存在。");
  const project = await assertProjectAccess(database, currentUser, String(motor.project_id));
  if (
    currentUser.role !== "admin" && currentUser.role !== "design" &&
    !isProjectSteward(currentUser, project)
  ) {
    throw new Error("只有设计、项目负责人或管理员可以维护设计输出要求。");
  }
  await getEditableProject(String(motor.project_id), currentUser);
  const context = await loadRevisionContext(database, String(motor.project_id), project);
  assertExpectedVersion(expectedRevision, Number(motor.design_revision || 1));
  if (!inspectionRequirement.trim() || !testRequirement.trim()) {
    throw new Error("检验要求和试验要求均不能为空。");
  }
  const designRevision = Number(motor.design_revision || 1) + 1;
  const mutation = database.prepare(`UPDATE npd_project_motors SET
    inspection_requirement=?, test_requirement=?,design_revision=?,status='planned',actual_date=NULL,
    confirmed_by=NULL,confirmed_at=NULL,production_note='',
    updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(inspectionRequirement.trim(), testRequirement.trim(), designRevision, motorId);
  const activity = activityStatement(database, String(motor.project_id), currentUser.id, "更新设计输出要求", "motor", motorId,
    `${String(motor.model)} 的检验要求和试验要求已更新至 R${designRevision}。`);
  const derived = await designChangeProgress(database, String(motor.project_id), { motor: {
    ...motor, design_revision: designRevision, status: "planned", actual_date: null, confirmed_by: null, confirmed_at: null,
    inspection_requirement: inspectionRequirement.trim(), test_requirement: testRequirement.trim(),
  } });
  await reviseProjectSheet(database, String(motor.project_id), "input_output", currentUser.id, {
    action: "更新设计输出要求", summary: `${String(motor.model)} 检验/试验要求更新至 R${designRevision}`,
    relatedProgress: derived.relatedProgress,
    reason: "设计输出要求调整", snapshot: { motorId, designRevision, before: motor },
    context, mutations: [mutation, activity], actorRole: currentUser.role,
    guard: { sql: "EXISTS (SELECT 1 FROM npd_project_motors WHERE id=? AND design_revision=?)", values: [motorId, expectedRevision] },
  }, true);
}

export async function saveNpdFormRecord(
  projectId: string,
  formCode: string,
  payload: Record<string, unknown>,
  submit: boolean,
  currentUser: NpdUser,
  changeReason = "",
  expectedVersion: number,
) {
  const sheetCode = formToSheet[formCode];
  if (!sheetCode) throw new Error("表单未映射到开发阶段 Sheet。");
  const definition = formDefinitions.find((form) => form.code === formCode);
  if (!definition) throw new Error("表单定义不存在。");
  const { database, project } = await getEditableProject(projectId, currentUser);
  if (!canEditSheet(currentUser, project, sheetCode)) {
    throw new Error(`当前角色无权编辑“${sheetByCode[sheetCode].title}”。`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("表单内容必须是字段记录。");
  const context = await loadRevisionContext(database, projectId, project);
  if (submit) {
    const issues = formSubmissionIssues(definition, payload);
    if (issues.length) throw new Error(`提交前请完成并校验：${issues.join("；")}。`);
  }
  const existing = await database.prepare(
    "SELECT id,version,status,payload FROM npd_form_records WHERE project_id=? AND form_code=?",
  ).bind(projectId, formCode).first<{ id: string; version: number; status: string; payload: string }>();
  assertExpectedVersion(expectedVersion, existing?.version || 0);
  const sheetBefore = context.sheets.find((sheet) => sheet.code === sheetCode);
  if ((existing?.status === "submitted" || sheetBefore?.status === "completed") && !changeReason.trim()) {
    throw new Error("已提交或已完成节点的数据再次修改时，必须填写变更原因。");
  }
  const status = submit ? "submitted" : "draft";
  const serialized = JSON.stringify(payload);
  let id = existing?.id;
  const mutations: D1PreparedStatement[] = [];
  if (existing) {
    mutations.push(database.prepare(`UPDATE npd_form_records SET status=?, payload=?,
      version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      status, serialized, existing.version + 1,
      currentUser.id, existing.id,
    ));
  } else {
    id = makeId("form");
    mutations.push(database.prepare(`INSERT INTO npd_form_records
      (id,project_id,form_code,sheet_code,status,version,payload,updated_by)
      VALUES (?,?,?,?,?,1,?,?)`).bind(
      id, projectId, formCode, sheetCode, status, serialized, currentUser.id,
    ));
  }
  const sheetForms = sheetByCode[sheetCode].formCodes;
  const submitted = await database.prepare(`SELECT COUNT(*) AS count FROM npd_form_records
    WHERE project_id=? AND sheet_code=? AND form_code<>? AND status='submitted'`).bind(projectId, sheetCode, formCode)
    .first<{ count: number }>();
  const submittedCount = (submitted?.count || 0) + (submit ? 1 : 0);
  const sheetStatus = submit && submittedCount === sheetForms.length
    ? "pending_review"
    : "in_progress";
  const sheetProgress = sheetForms.length
    ? Math.min(90, Math.round((submittedCount / sheetForms.length) * 90))
    : 10;
  mutations.push(activityStatement(database, projectId, currentUser.id,
    submit ? "提交阶段表单" : "保存阶段表单", "form", id!,
    `${definition.name} ${submit ? "已提交" : "已保存草稿"}。`));
  await reviseProjectSheet(database, projectId, sheetCode, currentUser.id, {
    action: submit ? "提交阶段表单" : "保存阶段表单",
    summary: `${definition.name}${submit ? "提交" : "保存草稿"}，表单版本 V${existing ? existing.version + 1 : 1}`,
    reason: changeReason.trim() || (existing ? "表单内容更新" : "首次录入"),
    status: sheetBefore?.status === "completed" ? "pending_review" : sheetStatus,
    progress: sheetProgress,
    context, mutations, actorRole: currentUser.role,
    guard: { sql: "COALESCE((SELECT version FROM npd_form_records WHERE project_id=? AND form_code=?),0)=?", values: [projectId, formCode, expectedVersion] },
    snapshot: { formCode, formVersion: existing ? existing.version + 1 : 1, formStatus: status,
      before: existing ? { ...existing, payload: JSON.parse(existing.payload) } : null },
  }, true);
  return { id };
}

export async function updateProjectSheet(
  projectId: string,
  sheetCode: SheetCode,
  input: { status: SheetStatus; progress: number; plannedDate: string; note: string; changeReason: string; expectedVersion: number },
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(projectId, currentUser);
  if (!canEditSheet(currentUser, project, sheetCode)) {
    throw new Error(`当前角色无权更新“${sheetByCode[sheetCode].title}”。`);
  }
  const context = await loadRevisionContext(database, projectId, project);
  assertExpectedVersion(input.expectedVersion, Number(context.sheets.find((sheet) => sheet.code === sheetCode)?.version));
  if (!["not_started", "in_progress", "pending_review", "completed", "blocked"].includes(input.status)) throw new Error("阶段状态无效。");
  if (!validDate(input.plannedDate) || !Number.isFinite(input.progress) || input.progress < 0 || input.progress > 100) {
    throw new Error("请填写有效的计划日期和 0～100 的完成度。");
  }
  if (!input.changeReason?.trim()) throw new Error("阶段状态、进度或节点日期变更必须填写原因。");
  const evidenceOriginals = input.status === "completed"
    ? await validateSheetCompletion(database, projectId, sheetCode) : [];
  const progress = input.status === "completed" ? 100 : Math.round(input.progress);
  const activity = activityStatement(database, projectId, currentUser.id, "更新阶段 Sheet", "sheet", sheetCode,
    `${sheetByCode[sheetCode].title} 更新为“${sheetStatusText(input.status)}”，完成度 ${progress}%：${input.changeReason.trim()}。`);
  await reviseProjectSheet(database, projectId, sheetCode, currentUser.id, {
    action: "更新阶段状态", summary: `状态更新为${sheetStatusText(input.status)}，完成度 ${progress}%`,
    reason: input.changeReason, status: input.status, progress, plannedDate: input.plannedDate,
    note: input.note, snapshot: { requestedStatus: input.status,
      ...(evidenceOriginals.length ? { evidenceOriginals: evidenceOriginals.map(({ documentId, fileName, size, etag, checkedAt }) =>
        ({ documentId, fileName, size, etag, checkedAt })) } : {}) },
    context, mutations: [activity], actorRole: currentUser.role,
    ...(evidenceOriginals.length ? { guard: {
      sql: `NOT EXISTS (SELECT 1 FROM json_each(?) e LEFT JOIN npd_documents d
        ON d.id=json_extract(e.value,'$.documentId') AND d.project_id=? AND d.sheet_code=?
        WHERE d.id IS NULL OR d.object_key<>json_extract(e.value,'$.objectKey')
          OR d.size<>json_extract(e.value,'$.size') OR d.file_name<>json_extract(e.value,'$.fileName'))`,
      values: [JSON.stringify(evidenceOriginals), projectId, sheetCode],
    } } : {}),
  }, true);
}

export async function addPartItem(
  input: {
    projectId: string;
    motorId: string | null;
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
  },
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(input.projectId, currentUser);
  if (
    currentUser.role !== "admin" && currentUser.role !== "design" &&
    currentUser.role !== "process" && currentUser.role !== "procurement" &&
    currentUser.role !== "production" && !isProjectSteward(currentUser, project)
  ) {
    throw new Error("只有设计、工艺、采购、生产、项目负责人或管理员可以新增零部件。");
  }
  const context = await loadRevisionContext(database, input.projectId, project);
  if (
    !input.partNo?.trim() || !input.name?.trim() || !input.designOutputRef?.trim() ||
    !input.inspectionRequirement?.trim() || !validDate(input.plannedDate)
  ) {
    throw new Error("零部件编号、名称、设计输出引用、检验要求和计划日期为必填项。");
  }
  if (input.motorId) {
    const motor = await database.prepare(
      "SELECT id FROM npd_project_motors WHERE id=? AND project_id=?",
    ).bind(input.motorId, input.projectId).first<Row>();
    if (!motor) throw new Error("关联电机规格不属于当前项目。");
  }
  const duplicate = await database.prepare("SELECT id FROM npd_part_items WHERE project_id=? AND lower(part_no)=lower(?) AND motor_id IS ?")
    .bind(input.projectId, input.partNo.trim(), input.motorId).first<Row>();
  if (duplicate) throw new Error("同一规格下已存在此零部件编号（系列通用件也不能重复）。");
  const id = makeId("part");
  const mutation = database.prepare(`INSERT INTO npd_part_items (
    id,project_id,motor_id,part_no,name,specification,material,quantity,source_type,
    design_output_ref,inspection_requirement,test_requirement,planned_date,status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'planned')`).bind(
    id, input.projectId, input.motorId, input.partNo.trim(), input.name.trim(),
    input.specification?.trim() || "", input.material?.trim() || "",
    Math.max(1, Number(input.quantity || 1)), input.sourceType || "自制",
    input.designOutputRef.trim(), input.inspectionRequirement.trim(),
    input.testRequirement?.trim() || "", input.plannedDate,
  );
  const activity = activityStatement(database, input.projectId, currentUser.id, "新增零部件", "part", id,
    `${input.partNo.trim()} ${input.name.trim()} 已加入节点计划，检验要求关联 ${input.designOutputRef.trim()}。`);
  const derived = await designChangeProgress(database, input.projectId, { part: {
    id, part_no: input.partNo.trim(), name: input.name.trim(), design_revision: 1,
    inspection_requirement: input.inspectionRequirement.trim(), status: "planned",
  } });
  await reviseProjectSheet(database, input.projectId, "parts_plan", currentUser.id, {
    action: "新增零部件", summary: `${input.partNo.trim()} ${input.name.trim()} 加入节点计划`,
    reason: "零部件范围增加", progress: derived.partsProgress, relatedProgress: derived.relatedProgress,
    snapshot: { partId: id, designRevision: 1 },
    status: context.sheets.find((sheet) => sheet.code === "parts_plan")?.status === "completed" ? "pending_review" : "in_progress",
    context, mutations: [mutation, activity], actorRole: currentUser.role,
    guard: { sql: "NOT EXISTS (SELECT 1 FROM npd_part_items WHERE project_id=? AND lower(part_no)=lower(?) AND motor_id IS ?)", values: [input.projectId, input.partNo.trim(), input.motorId] },
  }, true);
  return { id };
}

export async function updatePartItem(
  partId: string,
  input: Omit<Parameters<typeof addPartItem>[0], "projectId"> & { changeReason: string; expectedRevision: number },
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const part = await database.prepare("SELECT * FROM npd_part_items WHERE id=?")
    .bind(partId).first<Row>();
  if (!part) throw new Error("零部件记录不存在。");
  const project = await assertProjectAccess(database, currentUser, String(part.project_id));
  if (!["admin", "design", "process", "procurement"].includes(currentUser.role) &&
      !isProjectSteward(currentUser, project)) {
    throw new Error("只有设计、工艺、采购、项目负责人或管理员可以修改零部件设计输出。");
  }
  await getEditableProject(String(part.project_id), currentUser);
  const context = await loadRevisionContext(database, String(part.project_id), project);
  assertExpectedVersion(input.expectedRevision, Number(part.design_revision || 1));
  if (!input.changeReason?.trim() || !input.partNo?.trim() || !input.name?.trim() ||
      !input.designOutputRef?.trim() || !input.inspectionRequirement?.trim() ||
      !validDate(input.plannedDate)) {
    throw new Error("编号、名称、设计输出引用、检验要求、计划日期和变更原因均为必填项。");
  }
  if (input.motorId) {
    const motor = await database.prepare(`SELECT id FROM npd_project_motors
      WHERE id=? AND project_id=?`).bind(input.motorId, String(part.project_id)).first<Row>();
    if (!motor) throw new Error("关联电机规格不属于当前项目。");
  }
  const designRevision = Number(part.design_revision || 1) + 1;
  const duplicate = await database.prepare("SELECT id FROM npd_part_items WHERE project_id=? AND lower(part_no)=lower(?) AND motor_id IS ? AND id<>?")
    .bind(String(part.project_id), input.partNo.trim(), input.motorId, partId).first<Row>();
  if (duplicate) throw new Error("同一规格下已存在此零部件编号（系列通用件也不能重复）。");
  const mutation = database.prepare(`UPDATE npd_part_items SET motor_id=?,part_no=?,name=?,specification=?,
    material=?,quantity=?,source_type=?,design_output_ref=?,inspection_requirement=?,
    test_requirement=?,planned_date=?,design_revision=?,status='planned',actual_date=NULL,
    confirmed_by=NULL,confirmed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
    input.motorId, input.partNo.trim(), input.name.trim(), input.specification?.trim() || "",
    input.material?.trim() || "", Math.max(1, Number(input.quantity || 1)),
    input.sourceType || "自制", input.designOutputRef.trim(), input.inspectionRequirement.trim(),
    input.testRequirement?.trim() || "", input.plannedDate, designRevision, partId,
  );
  const activity = activityStatement(database, String(part.project_id), currentUser.id, "变更零部件", "part", partId,
    `${input.partNo.trim()} ${input.name.trim()} 更新至设计版次 R${designRevision}：${input.changeReason.trim()}。`);
  const derived = await designChangeProgress(database, String(part.project_id), { part: {
    ...part, part_no: input.partNo.trim(), name: input.name.trim(), design_revision: designRevision,
    inspection_requirement: input.inspectionRequirement.trim(), status: "planned",
  } });
  await reviseProjectSheet(database, String(part.project_id), "parts_plan", currentUser.id, {
    action: "变更零部件", summary: `${input.partNo.trim()} ${input.name.trim()} 更新至 R${designRevision}`,
    progress: derived.partsProgress, relatedProgress: derived.relatedProgress,
    reason: input.changeReason, snapshot: { partId, designRevision, previousRevision: part.design_revision, before: part },
    context, mutations: [mutation, activity], actorRole: currentUser.role,
    guard: { sql: "EXISTS (SELECT 1 FROM npd_part_items WHERE id=? AND design_revision=?) AND NOT EXISTS (SELECT 1 FROM npd_part_items WHERE project_id=? AND lower(part_no)=lower(?) AND motor_id IS ? AND id<>?)", values: [partId, input.expectedRevision, String(part.project_id), input.partNo.trim(), input.motorId, partId] },
  }, true);
}

export async function confirmMotorProduction(input: {
  motorId: string; status: "in_progress" | "completed" | "blocked"; actualDate: string;
  note: string; expectedRevision: number; expectedSheetVersion: number;
}, currentUser: NpdUser) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const motor = await database.prepare("SELECT * FROM npd_project_motors WHERE id=?").bind(input.motorId).first<Row>();
  if (!motor) throw new Error("电机规格不存在。");
  const projectId = String(motor.project_id);
  const { project } = await getEditableProject(projectId, currentUser);
  if (currentUser.role !== "admin" && currentUser.role !== "production") throw new Error("只有生产或管理员可以确认整机完成节点。");
  if (!["in_progress", "completed", "blocked"].includes(input.status)) throw new Error("生产节点状态无效。");
  if (typeof input.note !== "string" || !input.note.trim()) throw new Error("请填写生产确认说明或变更原因。");
  if (input.status === "completed" && (!validDate(input.actualDate) || input.actualDate > currentDateIso())) {
    throw new Error("请填写有效的实际完工日期，不能晚于今天。");
  }
  const context = await loadRevisionContext(database, projectId, project);
  assertExpectedVersion(input.expectedRevision, Number(motor.design_revision || 1));
  assertExpectedVersion(input.expectedSheetVersion, Number(context.sheets.find((sheet) => sheet.code === "parts_plan")?.version));
  const actualDate = input.status === "completed" ? input.actualDate : null;
  const production = await productionNodeProgress(database, projectId, { motor: {
    ...motor, status: input.status, actual_date: actualDate, confirmed_by: currentUser.id, confirmed_at: new Date().toISOString(),
  } });
  const mutation = database.prepare(`UPDATE npd_project_motors SET status=?,actual_date=?,confirmed_by=?,
    confirmed_at=CURRENT_TIMESTAMP,production_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
    input.status, actualDate, currentUser.id, input.note.trim(), input.motorId,
  );
  const label = input.status === "completed" ? "已完成" : input.status === "blocked" ? "受阻" : "进行中";
  const activity = activityStatement(database, projectId, currentUser.id, "确认整机节点", "motor", input.motorId,
    `${motor.model} · R${motor.design_revision} 更新为${label}${actualDate ? `（实际完工 ${actualDate}）` : ""}：${input.note.trim()}`);
  await reviseProjectSheet(database, projectId, "parts_plan", currentUser.id, {
    action: "确认整机节点", summary: `${motor.model} · ${label}；整机及零部件确认 ${production.completed}/${production.total}`,
    reason: input.note.trim(), status: "in_progress", progress: production.progress,
    context, mutations: [mutation, activity], actorRole: currentUser.role,
    snapshot: { motorId: input.motorId, completed: production.completed, total: production.total, before: motor },
    guard: { sql: "EXISTS (SELECT 1 FROM npd_project_motors WHERE id=? AND design_revision=?)", values: [input.motorId, input.expectedRevision] },
  }, true);
}

export async function confirmPartItem(
  partId: string,
  status: "in_progress" | "completed" | "blocked",
  note: string,
  currentUser: NpdUser,
  expectedRevision: number,
  expectedSheetVersion: number,
) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const part = await database.prepare("SELECT * FROM npd_part_items WHERE id=?")
    .bind(partId).first<Row>();
  if (!part) throw new Error("零部件记录不存在。");
  const projectId = String(part.project_id);
  const { project } = await getEditableProject(projectId, currentUser);
  if (currentUser.role !== "admin" && currentUser.role !== "production") {
    throw new Error("只有生产或管理员可以确认整机及零部件完成节点。");
  }
  if (!["in_progress", "completed", "blocked"].includes(status)) throw new Error("生产节点状态无效。");
  if (status === "blocked" && !note.trim()) throw new Error("受阻节点必须填写原因。");
  const context = await loadRevisionContext(database, projectId, project);
  assertExpectedVersion(expectedRevision, Number(part.design_revision || 1));
  assertExpectedVersion(expectedSheetVersion, Number(context.sheets.find((sheet) => sheet.code === "parts_plan")?.version));
  const actualDate = status === "completed" ? currentDateIso() : null;
  const mutation = database.prepare(`UPDATE npd_part_items SET status=?,actual_date=?,confirmed_by=?,
    confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
    status, actualDate, currentUser.id, partId,
  );
  const activity = activityStatement(database, projectId, currentUser.id, "确认零部件节点", "part", partId,
    `${String(part.part_no)} ${String(part.name)} 更新为 ${status === "completed" ? "已完成" : status === "blocked" ? "受阻" : "进行中"}${note.trim() ? `：${note.trim()}` : ""}。`);
  const { completed, total, progress } = await productionNodeProgress(database, projectId, { part: {
    ...part, status, actual_date: actualDate, confirmed_by: currentUser.id, confirmed_at: new Date().toISOString(),
  } });
  await reviseProjectSheet(database, projectId, "parts_plan", currentUser.id, {
    action: "确认节点状态", summary: `整机及零部件当前版次齐套 ${completed}/${total}，阶段完成度 ${progress}%`,
    reason: note.trim() || "生产确认", status: "in_progress", progress,
    context, mutations: [mutation, activity], actorRole: currentUser.role,
    snapshot: { partId, completed, total, before: part },
    guard: { sql: "EXISTS (SELECT 1 FROM npd_part_items WHERE id=? AND design_revision=?)", values: [partId, expectedRevision] },
  }, true);
}

export async function createTestReport(
  input: {
    projectId: string;
    motorId: string;
    reportNo: string;
    expectedRevision: number;
    reportType: string;
    title: string;
    requirementRef: string;
    testDate: string;
    result: string;
    conclusion: string;
    documentId: string | null;
  },
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(input.projectId, currentUser);
  if (
    currentUser.role !== "admin" && currentUser.role !== "tester" &&
    !isProjectSteward(currentUser, project)
  ) {
    throw new Error("只有试验员、项目负责人或管理员可以提交试验报告。");
  }
  const context = await loadRevisionContext(database, input.projectId, project);
  if (
    !input.motorId || !input.reportNo?.trim() || !input.title?.trim() ||
    !input.requirementRef?.trim() || !validDate(input.testDate) || !input.result
  ) {
    throw new Error("电机规格、报告编号、标题、试验要求引用、日期和结果为必填项。");
  }
  const motor = await database.prepare(
    "SELECT * FROM npd_project_motors WHERE id=? AND project_id=?",
  ).bind(input.motorId, input.projectId).first<Row>();
  if (!motor) throw new Error("试验报告关联的电机规格不存在。");
  assertExpectedVersion(input.expectedRevision, Number(motor.design_revision || 1));
  if (!["型式试验", "性能试验", "专项验证", "第三方检测"].includes(input.reportType) ||
      !["合格", "有条件合格", "不合格"].includes(input.result)) {
    throw new Error("试验报告类型或结果无效。");
  }
  if (!String(motor.test_requirement || "").trim() ||
      input.requirementRef.trim() !== String(motor.test_requirement).trim()) {
    throw new Error("试验要求必须与当前设计输出一致，请刷新页面后重新提交。");
  }
  if (input.result === "有条件合格" && !input.conclusion?.trim()) {
    throw new Error("有条件合格必须说明限制条件及处置依据。");
  }
  await assertDocumentLink(database, input.documentId, input.projectId, "verification", input.motorId);
  const duplicate = await database.prepare("SELECT id FROM npd_test_reports WHERE project_id=? AND lower(report_no)=lower(?)")
    .bind(input.projectId, input.reportNo.trim()).first<Row>();
  if (duplicate) throw new Error("该项目已有此报告编号，请查看现有记录；复测报告请使用新的报告编号。");
  const id = makeId("test");
  const mutations = [database.prepare(`INSERT INTO npd_test_reports (
    id,project_id,motor_id,report_no,report_type,title,requirement_ref,test_date,
    result,conclusion,document_id,requirement_revision,submitted_by
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, input.projectId, input.motorId, input.reportNo.trim(), input.reportType,
    input.title.trim(), input.requirementRef.trim(), input.testDate, input.result,
    input.conclusion?.trim() || "", input.documentId,
    Number(motor.design_revision || 1), currentUser.id,
  )];
  if (input.documentId) {
    mutations.push(database.prepare(`UPDATE npd_documents SET linked_record_id=?,kind='test_report',
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id, input.documentId));
  }
  mutations.push(activityStatement(database, input.projectId, currentUser.id, "提交试验报告", "test_report", id,
    `${String(motor.model)} · ${input.reportNo.trim()} · ${input.result}。`));
  await updateSpecialSheetProgress(database, input.projectId, "verification", currentUser.id, {
    context, mutations, actorRole: currentUser.role,
    action: "提交试验报告", summary: `${String(motor.model)} · ${input.reportNo.trim()} · ${input.result}`,
    snapshot: { reportId: id, documentId: input.documentId, requirementRevision: input.expectedRevision },
    guard: { sql: `EXISTS (SELECT 1 FROM npd_project_motors WHERE id=? AND design_revision=?)
      AND NOT EXISTS (SELECT 1 FROM npd_test_reports WHERE project_id=? AND lower(report_no)=lower(?))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM npd_documents WHERE id=? AND project_id=? AND sheet_code='verification' AND linked_record_id IS NULL))`,
      values: [input.motorId, input.expectedRevision, input.projectId, input.reportNo.trim(), input.documentId, input.documentId, input.projectId] },
  }, { motor_id: input.motorId, report_type: input.reportType, result: input.result,
    requirement_revision: input.expectedRevision, evidence_id: input.documentId,
    conclusion: input.conclusion || "", requirement_ref: input.requirementRef.trim() });
  return { id };
}

export async function createInspectionRecord(
  input: {
    projectId: string;
    expectedRevision: number;
    itemType: "motor" | "part";
    motorId: string | null;
    partItemId: string | null;
    inspectionDate: string;
    result: string;
    conclusion: string;
    documentId: string | null;
  },
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(input.projectId, currentUser);
  if (
    currentUser.role !== "admin" && currentUser.role !== "quality" &&
    !isProjectSteward(currentUser, project)
  ) {
    throw new Error("只有质量、项目负责人或管理员可以提交检验记录。");
  }
  const context = await loadRevisionContext(database, input.projectId, project);
  if (!validDate(input.inspectionDate) || !input.result) {
    throw new Error("检验日期和检验结果为必填项。");
  }
  if (!["motor", "part"].includes(input.itemType) ||
      !["合格", "让步接收", "不合格"].includes(input.result)) {
    throw new Error("检验对象类型或结果无效。");
  }
  if ((input.itemType === "motor" && input.partItemId) ||
      (input.itemType === "part" && input.motorId)) {
    throw new Error("每条检验记录只能关联一个整机或零部件。");
  }
  if (input.result === "让步接收" && !input.conclusion?.trim()) {
    throw new Error("让步接收必须填写处置依据及适用限制。");
  }
  let requirement = "";
  let designOutputRef = "";
  let itemName = "";
  let requirementRevision = 1;
  if (input.itemType === "motor") {
    if (!input.motorId) throw new Error("请选择待检验的整机规格。");
    const motor = await database.prepare(
      "SELECT * FROM npd_project_motors WHERE id=? AND project_id=?",
    ).bind(input.motorId, input.projectId).first<Row>();
    if (!motor) throw new Error("整机规格不存在。");
    requirement = String(motor.inspection_requirement || "").trim();
    designOutputRef = `电机设计输出 · ${String(motor.model)}`;
    itemName = String(motor.model);
    requirementRevision = Number(motor.design_revision || 1);
  } else {
    if (!input.partItemId) throw new Error("请选择待检验的零部件。");
    const part = await database.prepare(
      "SELECT * FROM npd_part_items WHERE id=? AND project_id=?",
    ).bind(input.partItemId, input.projectId).first<Row>();
    if (!part) throw new Error("零部件不存在。");
    requirement = String(part.inspection_requirement || "").trim();
    designOutputRef = String(part.design_output_ref || "").trim();
    itemName = `${String(part.part_no)} ${String(part.name)}`;
    requirementRevision = Number(part.design_revision || 1);
  }
  if (!requirement || !designOutputRef) {
    throw new Error("该对象尚未在设计输出中配置检验要求，不能提交检验记录。");
  }
  assertExpectedVersion(input.expectedRevision, requirementRevision);
  await assertDocumentLink(database, input.documentId, input.projectId, "quality_inspection", input.motorId);
  const id = makeId("inspection");
  const mutations = [database.prepare(`INSERT INTO npd_inspection_records (
    id,project_id,motor_id,part_item_id,item_type,inspection_requirement,
    design_output_ref,inspection_date,result,conclusion,document_id,requirement_revision,inspector_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, input.projectId, input.motorId, input.partItemId, input.itemType,
    requirement, designOutputRef, input.inspectionDate, input.result,
    input.conclusion?.trim() || "", input.documentId, requirementRevision, currentUser.id,
  )];
  if (input.documentId) {
    mutations.push(database.prepare(`UPDATE npd_documents SET linked_record_id=?,kind='inspection_record',
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id, input.documentId));
  }
  mutations.push(activityStatement(database, input.projectId, currentUser.id, "提交质量检验", "inspection", id,
    `${itemName} 检验结果：${input.result}。`));
  const targetTable = input.itemType === "motor" ? "npd_project_motors" : "npd_part_items";
  await updateSpecialSheetProgress(database, input.projectId, "quality_inspection", currentUser.id, {
    context, mutations, actorRole: currentUser.role,
    action: "提交检验记录", summary: `${itemName} 检验结果：${input.result}`,
    snapshot: { inspectionId: id, documentId: input.documentId, requirementRevision },
    guard: { sql: `EXISTS (SELECT 1 FROM ${targetTable} WHERE id=? AND design_revision=?)
      AND (? IS NULL OR EXISTS (SELECT 1 FROM npd_documents WHERE id=? AND project_id=? AND sheet_code='quality_inspection' AND linked_record_id IS NULL))`,
      values: [input.motorId || input.partItemId, input.expectedRevision, input.documentId, input.documentId, input.projectId] },
  }, { motor_id: input.motorId, part_item_id: input.partItemId, item_type: input.itemType, result: input.result,
    requirement_revision: requirementRevision, evidence_id: input.documentId, conclusion: input.conclusion || "",
    inspection_requirement: requirement });
  return { id };
}

export async function assignProjectMember(
  projectId: string,
  userId: string,
  responsibility: string,
  currentUser: NpdUser,
  expected: { id: string; version: number } | null,
) {
  const { database, project } = await getEditableProject(projectId, currentUser);
  if (!isProjectSteward(currentUser, project)) {
    throw new Error("只有项目发起人、负责人或管理员可以调整项目成员。");
  }
  if (!responsibility.trim()) throw new Error("请填写成员职责。");
  const user = await database.prepare("SELECT * FROM npd_users WHERE id=? AND active=1")
    .bind(userId).first<Row>();
  if (!user) throw new Error("成员不存在或已停用。");
  const existing = await database.prepare(
    "SELECT id,responsibility,version FROM npd_project_members WHERE project_id=? AND user_id=?",
  ).bind(projectId, userId).first<{ id: string; responsibility: string; version: number }>();
  if (expected === undefined || (existing
    ? !expected || expected.id !== existing.id || !Number.isSafeInteger(expected.version) || expected.version !== existing.version
    : expected !== null)) throw new NpdConflictError();
  const mutation = existing
    ? database.prepare(`UPDATE npd_project_members SET responsibility=?,
      version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(responsibility.trim(), existing.id)
    : database.prepare(`INSERT INTO npd_project_members
      (id,project_id,user_id,responsibility) VALUES (?,?,?,?)`).bind(
      makeId("member"), projectId, userId, responsibility.trim(),
    );
  const memberCondition = existing
    ? "EXISTS(SELECT 1 FROM npd_project_members WHERE id=? AND responsibility=? AND version=?)"
    : "NOT EXISTS(SELECT 1 FROM npd_project_members WHERE project_id=? AND user_id=?)";
  const memberValues = existing ? [existing.id, existing.responsibility, existing.version] : [projectId, userId];
  const audit = database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,CASE WHEN EXISTS(SELECT 1 FROM npd_projects p JOIN npd_users u ON u.id=?
      WHERE p.id=? AND p.status=? AND u.active=1 AND u.role=?
      AND (u.role='admin' OR p.owner_id=u.id OR p.initiator_id=u.id))
      AND EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role=?)
      AND ${memberCondition} THEN ? ELSE NULL END,'调整项目成员','member',?,?)`)
    .bind(makeId("activity"), projectId, currentUser.id, projectId, project.status, currentUser.role,
      userId, String(user.role), ...memberValues, currentUser.id, userId,
      `${String(user.name)}：${existing ? `原职责“${existing.responsibility}” → ` : "新增成员，"}现职责“${responsibility.trim()}”；成员版本 ${existing ? `V${existing.version} → ` : ""}V${existing ? existing.version + 1 : 1}。`);
  try { await database.batch([audit, mutation]); }
  catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_activities.actor_id")) throw new NpdConflictError();
    throw error;
  }
}

export async function transferNpdProjectOwner(input: {
  projectId: string; newOwnerId: string; reason: string;
  expectedOwnerId: string; expectedOwnershipVersion: number; expectedLifecycleVersion: number;
  previousOwnerResponsibility: string; newOwnerResponsibility: string;
  expectedMembers: Record<string, { id: string; version: number } | null>;
}, currentUser: NpdUser) {
  // Ownership maintenance remains available while paused, without resuming
  // development or changing any completed report. Closed projects stay admin-only.
  const { database, project } = await getEditableProject(input.projectId, currentUser, true);
  if (!isProjectSteward(currentUser, project)) throw new Error("只有项目发起人、当前负责人或管理员可以办理负责人交接。");
  if (input.expectedOwnerId !== project.ownerId || !Number.isSafeInteger(input.expectedOwnershipVersion) ||
    input.expectedOwnershipVersion !== project.ownershipVersion || !Number.isSafeInteger(input.expectedLifecycleVersion) ||
    input.expectedLifecycleVersion !== project.lifecycleVersion) throw new NpdConflictError();
  if (!input.newOwnerId || input.newOwnerId === project.ownerId) throw new Error("请选择与当前负责人不同的接任人员。");
  const reason = input.reason?.trim();
  const duties = [input.previousOwnerResponsibility?.trim(), input.newOwnerResponsibility?.trim()];
  if (!reason || duties.some((duty) => !duty)) throw new Error("请填写交接原因，以及新旧负责人交接后的职责。");
  if (reason.length > 2000 || duties.some((duty) => duty.length > 2000)) throw new Error("交接原因和每项职责最多2000字。");
  const target = await database.prepare("SELECT * FROM npd_users WHERE id=?").bind(input.newOwnerId).first<Row>();
  if (!target || !assignableOwner(mapUser(target))) throw new Error("接任负责人必须是已启用的销售、设计或管理员。");
  const memberIds = [project.ownerId, input.newOwnerId];
  const members = await database.prepare("SELECT * FROM npd_project_members WHERE project_id=? AND user_id IN (?,?)")
    .bind(project.id, ...memberIds).all<Row>();
  const guardParts: string[] = [];
  const guardValues: (string | number | null)[] = [];
  const mutations: D1PreparedStatement[] = [];
  const changes = memberIds.map((userId, index) => {
    const existing = members.results.find((row) => row.user_id === userId);
    const expected = input.expectedMembers?.[userId];
    if (expected === undefined || (existing ? !expected || expected.id !== existing.id ||
      !Number.isSafeInteger(expected.version) || expected.version !== Number(existing.version) : expected !== null)) throw new NpdConflictError();
    if (existing) {
      guardParts.push("EXISTS(SELECT 1 FROM npd_project_members WHERE id=? AND project_id=? AND user_id=? AND version=?)");
      guardValues.push(String(existing.id), project.id, userId, Number(existing.version));
      mutations.push(database.prepare("UPDATE npd_project_members SET responsibility=?,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(duties[index], existing.id));
    } else {
      guardParts.push("NOT EXISTS(SELECT 1 FROM npd_project_members WHERE project_id=? AND user_id=?)");
      guardValues.push(project.id, userId);
      mutations.push(database.prepare("INSERT INTO npd_project_members(id,project_id,user_id,responsibility) VALUES (?,?,?,?)")
        .bind(makeId("member"), project.id, userId, duties[index]));
    }
    return { userId, previousResponsibility: existing?.responsibility ?? null, responsibility: duties[index],
      previousMemberVersion: existing?.version ?? null, memberVersion: existing ? Number(existing.version) + 1 : 1 };
  });
  const audit = database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,CASE WHEN EXISTS(SELECT 1 FROM npd_projects p JOIN npd_users u ON u.id=?
      WHERE p.id=? AND p.owner_id=? AND p.ownership_version=? AND p.lifecycle_version=? AND p.status=?
      AND u.active=1 AND u.role=? AND (u.role='admin' OR p.owner_id=u.id OR p.initiator_id=u.id)
      AND (p.status NOT IN ('completed','cancelled') OR u.role='admin'))
      AND EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role IN ('admin','sales','design') AND version=?)
      AND ${guardParts.join(" AND ")} THEN ? ELSE NULL END,'项目负责人交接','project',?,?)`)
    .bind(makeId("activity"), project.id, currentUser.id, project.id, project.ownerId, project.ownershipVersion,
      project.lifecycleVersion, project.status, currentUser.role, input.newOwnerId, Number(target.version), ...guardValues,
      currentUser.id, project.id, `负责人 ${project.ownerName}（${project.ownerId}） → ${String(target.name)}（${input.newOwnerId}）；交接版本 V${project.ownershipVersion} → V${project.ownershipVersion + 1}；原因：${reason}。` +
        changes.map((change, index) => `${index ? "新" : "原"}负责人职责：${change.previousResponsibility ?? "未分配"} → ${change.responsibility}（成员版本${change.previousMemberVersion ? ` V${change.previousMemberVersion} →` : ""} V${change.memberVersion}）。`).join("") +
        "发起人和既有报告不变，原负责人保留成员身份；其管理权限按当前角色和发起人身份重新计算。");
  try {
    await database.batch([audit, ...mutations, database.prepare(`UPDATE npd_projects SET owner_id=?,
      ownership_version=ownership_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(input.newOwnerId, project.id)]);
  } catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_activities.actor_id")) throw new NpdConflictError();
    throw error;
  }
}

export async function setNpdProjectStatus(
  projectId: string,
  status: "active" | "paused" | "cancelled",
  reason: string,
  currentUser: NpdUser,
  expectedStatus: ProjectStatus,
  expectedLifecycleVersion: number,
) {
  const { database, project } = await getEditableProject(projectId, currentUser, true);
  if (!isProjectSteward(currentUser, project)) {
    throw new Error("只有项目发起人、负责人或管理员可以变更项目状态。");
  }
  if (!["active", "paused", "cancelled"].includes(status)) throw new Error("项目状态无效。");
  if (expectedStatus !== project.status || !Number.isSafeInteger(expectedLifecycleVersion) ||
    expectedLifecycleVersion !== project.lifecycleVersion) throw new NpdConflictError();
  if (status === project.status) throw new Error("项目已经处于该状态，无需重复提交。");
  if (!reason?.trim()) throw new Error("变更项目状态必须填写原因，包括恢复依据。");
  const audit = database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,CASE WHEN EXISTS(SELECT 1 FROM npd_projects p JOIN npd_users u ON u.id=?
      WHERE p.id=? AND p.status=? AND p.lifecycle_version=? AND u.active=1 AND u.role=?
      AND (u.role='admin' OR p.owner_id=u.id OR p.initiator_id=u.id))
      THEN ? ELSE NULL END,'变更项目状态','project',?,?)`)
    .bind(makeId("activity"), projectId, currentUser.id, projectId, expectedStatus, expectedLifecycleVersion, currentUser.role,
      currentUser.id, projectId, `${project.status} → ${status}：${reason.trim()}；状态版本 V${expectedLifecycleVersion} → V${expectedLifecycleVersion + 1}。`);
  try {
    await database.batch([audit, database.prepare(`UPDATE npd_projects SET status=?,lifecycle_version=lifecycle_version+1,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status, projectId)]);
  } catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_activities.actor_id")) throw new NpdConflictError();
    throw error;
  }
}

export interface CreateNpdUserInput {
  email: string;
  name: string;
  department: string;
  role: NpdRole;
  active: boolean;
  password?: string;
}

// The audit row is also the transaction guard. Its NOT NULL actor_id aborts
// the entire batch if the administrator or account changed after validation.
function accountAuditGuard(database: D1Database, actorId: string, action: string, userId: string,
  details: string, condition = "1", values: Array<string | number | null> = []) {
  return database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,NULL,CASE WHEN EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role='admin')
      AND (${condition}) THEN ? ELSE NULL END,?,'user',?,?)`)
    .bind(makeId("activity"), actorId, ...values, actorId, action, userId, details);
}

async function commitAccountChanges(database: D1Database, statements: D1PreparedStatement[]) {
  try { await database.batch(statements); }
  catch (error) {
    if (String(error).includes("NOT NULL constraint failed: npd_activities.actor_id")) {
      throw new NpdConflictError();
    }
    throw error;
  }
}

export async function createNpdUser(
  input: CreateNpdUserInput,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  if (currentUser.role !== "admin") throw new Error("只有管理员可以新建账户。");
  const database = getDatabase();
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const department = input.department.trim();
  if (!name) throw new Error("请填写人员姓名。");
  if (!isValidAccountEmail(email)) throw new Error("请填写有效的登录邮箱。");
  if (!department) throw new Error("请填写所属部门。");
  if (!isNpdRole(input.role)) throw new Error("登录类型无效。");
  const credentials = input.password ? await createPasswordCredentials(input.password) : null;
  const duplicate = await database.prepare(
    "SELECT id FROM npd_users WHERE lower(email)=lower(?)",
  ).bind(email).first<{ id: string }>();
  if (duplicate) throw new Error("该登录邮箱已存在，请直接维护原账户。");
  const id = makeId("user");
  const mutation = database.prepare(`INSERT INTO npd_users
    (id,email,name,department,role,active,bootstrap_admin,password_salt,password_hash)
    VALUES (?,?,?,?,?,?,0,?,?)`).bind(
      id, email, name, department, input.role, input.active ? 1 : 0,
      credentials?.salt || null, credentials?.hash || null,
    );
  await commitAccountChanges(database, [accountAuditGuard(database, currentUser.id, "新建登录账户", id,
    `${name}（${email}）已创建为${roleLabels[input.role]}，账号${input.active ? "启用" : "停用"}。`,
    "NOT EXISTS(SELECT 1 FROM npd_users WHERE lower(email)=lower(?))", [email]), mutation]);
  const created = await database.prepare("SELECT * FROM npd_users WHERE id=?")
    .bind(id).first<Row>();
  if (!created) throw new Error("账户创建失败。");
  return mapUser(created);
}

export async function updateNpdUser(
  input: { userId: string; email: string; name: string; role: NpdRole; department: string; active: boolean; password?: string;
    expected: Pick<NpdUser, "email" | "name" | "role" | "department" | "active" | "updatedAt" | "version"> },
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  if (currentUser.role !== "admin") throw new Error("只有管理员可以维护人员权限。");
  const database = getDatabase();
  const target = await database.prepare("SELECT * FROM npd_users WHERE id=?")
    .bind(input.userId).first<Row>();
  if (!target) throw new Error("用户不存在。");
  const previous = mapUser(target);
  if (!input.expected || !Number.isSafeInteger(input.expected.version) || input.expected.version < 1 ||
    (["email", "name", "role", "department", "active", "updatedAt", "version"] as const)
    .some((key) => input.expected[key] !== previous[key])) throw new NpdConflictError();
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const department = input.department.trim();
  if (!name) throw new Error("请填写人员姓名。");
  if (!isValidAccountEmail(email)) throw new Error("请填写有效的登录邮箱。");
  if (!department) throw new Error("请填写所属部门。");
  if (!isNpdRole(input.role)) throw new Error("登录类型无效。");
  const credentials = input.password ? await createPasswordCredentials(input.password) : null;
  if (input.userId === currentUser.id && !input.active) {
    throw new Error("不能停用当前登录账户，请由其他管理员操作。");
  }
  if (input.userId === currentUser.id && email !== normalizeEmail(currentUser.email)) {
    throw new Error("不能修改当前登录账户的邮箱，以免失去访问权限。");
  }
  const duplicate = await database.prepare(
    "SELECT id FROM npd_users WHERE lower(email)=lower(?) AND id<>?",
  ).bind(email, input.userId).first<{ id: string }>();
  if (duplicate) throw new Error("该登录邮箱已被其他账户使用。");
  if (normalizeRole(target.role) === "admin" && (!input.active || input.role !== "admin")) {
    const admins = await database.prepare(
      "SELECT COUNT(*) AS count FROM npd_users WHERE role='admin' AND active=1",
    ).first<{ count: number }>();
    if ((admins?.count || 0) <= 1) throw new Error("系统必须保留至少一名有效管理员。");
  }
  const updates = [database.prepare(`UPDATE npd_users SET email=?,name=?,role=?,department=?,active=?,
    password_salt=COALESCE(?,password_salt),password_hash=COALESCE(?,password_hash),
    version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      email, name, input.role, department, input.active ? 1 : 0,
      credentials?.salt || null, credentials?.hash || null, input.userId,
    )];
  if (credentials || !input.active || input.role !== target.role || email !== target.email) {
    updates.push(database.prepare("DELETE FROM npd_local_sessions WHERE user_id=?").bind(input.userId));
  }
  const preserveAdmin = target.role === "admin" && (!input.active || input.role !== "admin");
  const changes = [
    previous.name !== name ? `姓名：${previous.name} → ${name}` : "",
    previous.email !== email ? `邮箱：${previous.email} → ${email}` : "",
    previous.department !== department ? `部门：${previous.department} → ${department}` : "",
    previous.role !== input.role ? `角色：${roleLabels[previous.role]} → ${roleLabels[input.role]}` : "",
    previous.active !== input.active ? `状态：${previous.active ? "启用" : "停用"} → ${input.active ? "启用" : "停用"}` : "",
    credentials ? "本地密码已重置，旧会话已撤销" : "",
  ].filter(Boolean);
  const guard = accountAuditGuard(database, currentUser.id, "更新人员权限", input.userId,
    `${name}（${email}）账户 V${previous.version} → V${previous.version + 1}：${changes.join("；") || "确认账户资料，内容未变"}。`,
    `EXISTS(SELECT 1 FROM npd_users WHERE id=? AND email=? AND name=? AND role=? AND department=?
      AND active=? AND password_hash IS ? AND password_salt IS ? AND version=?)
      AND (?=0 OR EXISTS(SELECT 1 FROM npd_users WHERE role='admin' AND active=1 AND id<>?))`,
    [input.userId, String(target.email), String(target.name), String(target.role), String(target.department),
      Number(target.active), target.password_hash, target.password_salt, previous.version, preserveAdmin ? 1 : 0, input.userId]);
  await commitAccountChanges(database, [guard, ...updates]);
}

export async function saveDashboardPreference(
  preference: DashboardPreference,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  const validated = validateDashboardPreference(preference);
  const database = getDatabase();
  const mutation = database.prepare(`INSERT INTO npd_dashboard_preferences (user_id,payload)
    VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,
    updated_at=CURRENT_TIMESTAMP`).bind(currentUser.id, JSON.stringify(validated));
  const audit = database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,NULL,CASE WHEN EXISTS(SELECT 1 FROM npd_users WHERE id=? AND active=1 AND role=?)
      THEN ? ELSE NULL END,'更新看板配置','dashboard',?,?)`)
    .bind(makeId("activity"), currentUser.id, currentUser.role, currentUser.id, currentUser.id,
      `统计周期调整为 ${validated.periodMode}，显示 ${validated.visibleMetrics.length} 项指标。`);
  await commitAccountChanges(database, [audit, mutation]);
}

export async function insertNpdDocument(
  input: {
    projectId: string;
    sheetCode: SheetCode;
    motorId: string | null;
    linkedRecordId: string | null;
    kind: string;
    fileName: string;
    objectKey: string;
    contentType: string;
    size: number;
  },
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(input.projectId, currentUser);
  if (!canEditSheet(currentUser, project, input.sheetCode)) {
    throw new Error(`当前角色无权向“${sheetByCode[input.sheetCode].title}”上传附件。`);
  }
  if (input.linkedRecordId) throw new Error("请先上传阶段附件，再通过报告或检验提交操作关联记录。");
  const context = await loadRevisionContext(database, input.projectId, project);
  if (input.motorId) {
    const motor = await database.prepare(
      "SELECT id FROM npd_project_motors WHERE id=? AND project_id=?",
    ).bind(input.motorId, input.projectId).first<Row>();
    if (!motor) throw new Error("附件关联的电机规格不存在。");
  }
  const id = makeId("document");
  const mutation = database.prepare(`INSERT INTO npd_documents (
    id,project_id,sheet_code,motor_id,linked_record_id,kind,file_name,object_key,
    content_type,size,version,uploaded_by
  ) VALUES (?,?,?,?,?,?,?,?,?,?, 'A1',?)`).bind(
    id, input.projectId, input.sheetCode, input.motorId, input.linkedRecordId,
    input.kind, input.fileName, input.objectKey, input.contentType, input.size,
    currentUser.id,
  );
  const activity = activityStatement(database, input.projectId, currentUser.id, "上传附件", "document", id,
    `${input.fileName} 已上传至 ${sheetByCode[input.sheetCode].shortTitle}。`);
  await reviseProjectSheet(database, input.projectId, input.sheetCode, currentUser.id, {
    action: "上传阶段附件", summary: `新增附件 ${input.fileName}`,
    reason: "补充阶段证据", snapshot: { documentId: id, kind: input.kind, motorId: input.motorId },
    context, mutations: [mutation, activity], actorRole: currentUser.role,
  }, true);
  return id;
}

export async function getNpdRevisionDetail(id: string, currentUser: NpdUser) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  const database = getDatabase();
  const row = await database.prepare(`SELECT r.*,u.name AS actor_name FROM npd_sheet_revisions r
    JOIN npd_users u ON u.id=r.actor_id WHERE r.id=?`).bind(id).first<Row>();
  if (!row) return null;
  await assertProjectAccess(database, currentUser, String(row.project_id));
  let snapshot: unknown = null;
  try { snapshot = JSON.parse(String(row.snapshot)); } catch { /* Legacy data may not contain a readable snapshot. */ }
  return { ...mapSheetRevision(row), snapshot };
}

export async function getNpdDocument(
  documentId: string,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const row = await database.prepare("SELECT * FROM npd_documents WHERE id=?")
    .bind(documentId).first<Row>();
  if (!row) return null;
  await assertProjectAccess(database, currentUser, String(row.project_id));
  return mapDocument({ ...row, uploaded_by_name: "" });
}

export async function getNpdProjectArchiveData(
  projectId: string,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  const database = getDatabase();
  // D1 batch is one transaction. Scope every query at the database boundary,
  // using the account and membership in that transaction, not the request's
  // earlier user object. No unrelated projects or credential columns are read.
  const authorizedProject = `WITH archive_project AS (
    SELECT p.*, requester.name AS archive_exported_by,
      strftime('%Y-%m-%dT%H:%M:%fZ','now') AS archive_captured_at
    FROM npd_projects p JOIN npd_users requester ON requester.id=?
    WHERE p.id=? AND requester.active=1 AND (
      requester.role='admin' OR p.initiator_id=requester.id OR p.owner_id=requester.id OR
      EXISTS (SELECT 1 FROM npd_project_members access_member
        WHERE access_member.project_id=p.id AND access_member.user_id=requester.id)))`;
  const query = (sql: string) => database.prepare(`${authorizedProject} ${sql}`).bind(currentUser.id, projectId);
  const [projectResult, customerResult, orderResult, memberResult, motorResult,
    sheetResult, formResult, partResult, testResult, inspectionResult,
    documentResult, activityResult, revisionResult] = await database.batch<Row>([
    query(`SELECT p.*, c.name AS customer_name, initiator.name AS initiator_name, owner.name AS owner_name
      FROM archive_project p LEFT JOIN npd_customers c ON c.id=p.customer_id
      LEFT JOIN npd_users initiator ON initiator.id=p.initiator_id
      LEFT JOIN npd_users owner ON owner.id=p.owner_id`),
    query("SELECT c.* FROM npd_customers c JOIN archive_project p ON p.customer_id=c.id"),
    query(`SELECT o.*, c.name AS customer_name, p.code AS project_code, u.name AS created_by_name
      FROM npd_sales_orders o JOIN archive_project p ON p.id=o.project_id
      LEFT JOIN npd_customers c ON c.id=o.customer_id LEFT JOIN npd_users u ON u.id=o.created_by
      ORDER BY o.order_date DESC,o.order_no DESC`),
    query(`SELECT m.*, u.name AS user_name,u.role AS user_role FROM npd_project_members m
      JOIN archive_project p ON p.id=m.project_id LEFT JOIN npd_users u ON u.id=m.user_id
      ORDER BY m.created_at,m.id`),
    query(`SELECT m.*,u.name AS confirmed_by_name FROM npd_project_motors m JOIN archive_project p ON p.id=m.project_id LEFT JOIN npd_users u ON u.id=m.confirmed_by
      ORDER BY m.model,m.id`),
    query(`SELECT s.*, u.name AS updated_by_name FROM npd_project_sheets s
      JOIN archive_project p ON p.id=s.project_id LEFT JOIN npd_users u ON u.id=s.updated_by
      ORDER BY s.sort_order,s.id`),
    query(`SELECT f.*, u.name AS updated_by_name FROM npd_form_records f
      JOIN archive_project p ON p.id=f.project_id LEFT JOIN npd_users u ON u.id=f.updated_by
      ORDER BY f.sheet_code,f.form_code,f.id`),
    query(`SELECT part.*, m.model AS motor_model,u.name AS confirmed_by_name FROM npd_part_items part
      JOIN archive_project p ON p.id=part.project_id LEFT JOIN npd_project_motors m ON m.id=part.motor_id
      LEFT JOIN npd_users u ON u.id=part.confirmed_by ORDER BY part.planned_date,part.part_no,part.id`),
    query(`SELECT t.*,m.model AS motor_model,u.name AS submitted_by_name,d.file_name AS file_name
      FROM npd_test_reports t JOIN archive_project p ON p.id=t.project_id
      LEFT JOIN npd_project_motors m ON m.id=t.motor_id LEFT JOIN npd_users u ON u.id=t.submitted_by
      LEFT JOIN npd_documents d ON d.id=t.document_id ORDER BY t.created_at DESC,t.rowid DESC`),
    query(`SELECT i.*,m.model AS motor_model,part.name AS part_name,u.name AS inspector_name,d.file_name AS file_name
      FROM npd_inspection_records i JOIN archive_project p ON p.id=i.project_id
      LEFT JOIN npd_project_motors m ON m.id=i.motor_id LEFT JOIN npd_part_items part ON part.id=i.part_item_id
      LEFT JOIN npd_users u ON u.id=i.inspector_id LEFT JOIN npd_documents d ON d.id=i.document_id
      ORDER BY i.created_at DESC,i.rowid DESC`),
    query(`SELECT d.*,u.name AS uploaded_by_name FROM npd_documents d
      JOIN archive_project p ON p.id=d.project_id LEFT JOIN npd_users u ON u.id=d.uploaded_by
      ORDER BY d.created_at DESC,d.id`),
    query(`SELECT a.*, p.code AS project_code, u.name AS actor_name
      FROM npd_activities a JOIN archive_project p ON p.id=a.project_id
      LEFT JOIN npd_users u ON u.id=a.actor_id
      ORDER BY a.created_at DESC,a.rowid DESC`),
    query(`SELECT r.*, u.name AS actor_name FROM npd_sheet_revisions r
      JOIN archive_project p ON p.id=r.project_id LEFT JOIN npd_users u ON u.id=r.actor_id
      ORDER BY r.sheet_code,r.version DESC`),
  ]);
  const row = projectResult.results[0];
  if (!row) throw new Error("项目不存在或无权访问，账户可能已停用或项目权限已变更。");
  const motors = motorResult.results.map(mapMotor);
  const sheets = sheetResult.results.map(mapSheet);
  const project = mapProjectBase(row);
  project.motorCount = motors.length;
  project.currentSheetTitle = sheets.find((sheet) => sheet.code === project.currentSheetCode)?.title || project.currentSheetTitle;
  project.overdueDays = projectOverdueDays(project);
  return {
    capturedAt: String(row.archive_captured_at),
    exportedBy: String(row.archive_exported_by),
    project,
    customer: customerResult.results[0] ? mapCustomer(customerResult.results[0]) : null,
    orders: orderResult.results.map(mapOrder),
    members: memberResult.results.map(mapMember),
    motors,
    sheets,
    revisions: revisionResult.results.map((row) => ({ ...mapSheetRevision(row), snapshotJson: String(row.snapshot) })),
    forms: formResult.results.map(mapForm),
    parts: partResult.results.map(mapPart),
    tests: testResult.results.map(mapTestReport),
    inspections: inspectionResult.results.map(mapInspection),
    documents: documentResult.results.map(mapDocument),
    activities: activityResult.results.map(mapActivity),
  };
}

async function getEditableProject(projectId: string, currentUser: NpdUser, allowLifecycleChange = false) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  const database = getDatabase();
  const project = await assertProjectAccess(database, currentUser, projectId);
  if (project.status === "paused" && !allowLifecycleChange) {
    throw new Error("项目已暂停，业务数据为只读；请由项目负责人、发起人或管理员说明原因并恢复后再修改。");
  }
  if (project.status === "completed" || project.status === "cancelled") {
    if (currentUser.role !== "admin") throw new Error("已完成或已终止项目仅管理员可修改。");
  }
  return { database, project };
}

async function assertProjectAccess(
  database: D1Database,
  currentUser: NpdUser,
  projectId: string,
) {
  const row = await database.prepare(`SELECT p.*, c.name AS customer_name,
    initiator.name AS initiator_name, owner.name AS owner_name
    FROM npd_projects p JOIN npd_customers c ON c.id=p.customer_id
    JOIN npd_users initiator ON initiator.id=p.initiator_id
    JOIN npd_users owner ON owner.id=p.owner_id WHERE p.id=?`).bind(projectId).first<Row>();
  if (!row) throw new Error("项目不存在。");
  const project = mapProjectBase(row);
  const members = await database.prepare(`SELECT m.*, u.name AS user_name,u.role AS user_role
    FROM npd_project_members m JOIN npd_users u ON u.id=m.user_id WHERE m.project_id=?`)
    .bind(projectId).all<Row>();
  if (!canSeeProject(currentUser, project, members.results.map(mapMember))) {
    throw new Error("您只能访问自己发起、负责或被分配参与的项目。");
  }
  return project;
}

async function reviseProjectSheet(
  database: D1Database,
  projectId: string,
  sheetCode: SheetCode,
  actorId: string,
  change: SheetRevisionChange,
  invalidateDownstream = false,
) {
  return commitSheetRevision(database, projectId, sheetCode, actorId, change,
    invalidateDownstream, currentDateIso());
}

async function validateSheetCompletion(
  database: D1Database,
  projectId: string,
  sheetCode: SheetCode,
) {
  const sheet = sheetByCode[sheetCode];
  const previous = await database.prepare(`SELECT title,status FROM npd_project_sheets
    WHERE project_id=? AND sort_order<? ORDER BY sort_order`).bind(projectId, sheet.index).all<Row>();
  const unfinished = previous.results.find((row) => row.status !== "completed");
  if (unfinished) throw new Error(`前置阶段“${String(unfinished.title)}”尚未完成，不能放行当前 Sheet。`);

  if (sheet.formCodes.length) {
    const forms = await database.prepare(`SELECT form_code,status,payload FROM npd_form_records
      WHERE project_id=? AND sheet_code=?`).bind(projectId, sheetCode).all<Row>();
    const missing = sheet.formCodes.filter((formCode) =>
      !forms.results.some((row) => row.form_code === formCode && row.status === "submitted"),
    );
    if (missing.length) {
      const names = missing.map((code) => formDefinitions.find((form) => form.code === code)?.name || code);
      throw new Error(`以下受控表单尚未提交：${names.join("、")}。`);
    }
    for (const formCode of sheet.formCodes) {
      const definition = formDefinitions.find((form) => form.code === formCode)!;
      const record = forms.results.find((row) => row.form_code === formCode)!;
      let payload: unknown;
      try { payload = JSON.parse(String(record.payload)); }
      catch { throw new Error(`${definition.name}内容无法读取，请核对并保存新的受控版本后再放行。`); }
      const issues = formReleaseIssues(definition, payload);
      if (issues.length) throw new Error(`${definition.name}不能放行：${issues.join("；")}。`);
    }
  }

  if (sheetCode === "parts_plan") {
    const production = await productionNodeProgress(database, projectId);
    if (!production.partCount) throw new Error("零部件明细为空，不能完成节点阶段。");
    if (!production.motorCount) throw new Error("整机规格为空，不能完成节点阶段。");
    if (production.issues.length) throw new Error(`仍有整机或零部件节点未由生产确认完成：${production.issues.join("；")}。`);
  }
  if (sheetCode === "input_output") {
    const motors = await database.prepare("SELECT * FROM npd_project_motors WHERE project_id=?")
      .bind(projectId).all<Row>();
    if (!motors.results.length) throw new Error("请先录入至少一个电机规格。");
    const required = { terminal_mode: "出线形式", protection_grade: "防护等级",
      insulation_class: "绝缘等级", cooling_method: "冷却方式",
      inspection_requirement: "检验要求", test_requirement: "试验要求" };
    const missing = motors.results.flatMap((motor) => {
      const fields = Object.entries(required).filter(([key]) => !String(motor[key] || "").trim()).map(([, label]) => label);
      return fields.length ? [`${motor.model}：${fields.join("、")}`] : [];
    });
    if (missing.length) throw new Error(`设计输出尚未完整：${missing.join("；")}。`);
  }
  if (sheetCode === "verification" || sheetCode === "quality_inspection") {
    const evidence = await getStageEvidence(database, projectId, sheetCode);
    if (evidence.issues.length) throw new Error(evidence.issues.join("；"));
    return verifyStageOriginals(database, projectId, sheetCode, evidence.documentIds);
  }
  return [];
}

async function verifyStageOriginals(database: D1Database, projectId: string, sheetCode: SheetCode, documentIds: string[]) {
  const bucket = getNpdRuntimeEnv().FILES;
  if (!bucket) throw new Error("附件存储未就绪，无法核验报告原件，不能完成阶段。");
  const verified = [];
  for (const documentId of new Set(documentIds)) {
    const row = await database.prepare(`SELECT file_name,object_key,size FROM npd_documents
      WHERE id=? AND project_id=? AND sheet_code=?`).bind(documentId, projectId, sheetCode).first<Row>();
    if (!row) throw new Error("报告附件索引已变化，请刷新后重新复核，不能完成阶段。");
    const fileName = String(row.file_name);
    const objectKey = String(row.object_key);
    const size = Number(row.size);
    if (!objectKey.startsWith(`npd/${projectId}/`) || !Number.isSafeInteger(size) || size < 1) {
      throw new Error(`报告原件记录异常：${fileName}，请核对归属及文件大小。`);
    }
    let metadata: R2Object | null;
    try { metadata = await bucket.head(objectKey); }
    catch { throw new Error(`暂时无法核验报告原件：${fileName}，请稍后重试，不能完成阶段。`); }
    if (!metadata) throw new Error(`报告原件缺失：${fileName}，请重新上传并提交有效报告后再完成阶段。`);
    if (metadata.size !== size || !metadata.etag) throw new Error(`报告原件与记录不一致：${fileName}，不能完成阶段。`);
    verified.push({ documentId, objectKey, fileName, size, etag: metadata.etag, checkedAt: new Date().toISOString() });
  }
  return verified;
}

async function getStageEvidence(
  database: D1Database, projectId: string, sheetCode: "verification" | "quality_inspection",
  pending?: Row,
  projection: { motor?: Row; part?: Row } = {},
) {
  const motors = await database.prepare("SELECT * FROM npd_project_motors WHERE project_id=?")
    .bind(projectId).all<Row>();
  motors.results = projectEvidenceRows(motors.results, projection.motor);
  const issues: string[] = [];
  const documentIds: string[] = [];
  let total = motors.results.length;
  let completed = 0;
  if (!total) issues.push("项目没有电机规格，不能完成阶段");
  if (sheetCode === "verification") {
    // rowid resolves same-second submissions by insertion order. A report in a
    // different category cannot supersede an outstanding failed test.
    const reports = await database.prepare(`SELECT r.*,d.id AS evidence_id FROM npd_test_reports r
      LEFT JOIN npd_documents d ON d.id=r.document_id AND d.project_id=r.project_id
        AND d.sheet_code='verification'
      WHERE r.project_id=? ORDER BY r.created_at DESC,r.rowid DESC`).bind(projectId).all<Row>();
    if (pending) reports.results.unshift(pending);
    for (const motor of motors.results) {
      const latest = new Map<string, Row>();
      for (const report of reports.results) {
        if (report.motor_id !== motor.id || Number(report.requirement_revision) !== Number(motor.design_revision)) continue;
        if (!latest.has(String(report.report_type))) latest.set(String(report.report_type), report);
      }
      const problems = testEvidenceIssues(String(motor.test_requirement || ""), [...latest.entries()].map(([type, report]) => ({
        type, result: String(report.result), hasAttachment: Boolean(report.evidence_id),
        conclusion: String(report.conclusion || ""), requirementRef: String(report.requirement_ref || ""),
      })));
      for (const report of latest.values()) if (report.evidence_id) documentIds.push(String(report.evidence_id));
      if (problems.length) issues.push(`${motor.model}：${problems.join("、")}`);
      else completed++;
    }
  } else {
    const parts = await database.prepare("SELECT * FROM npd_part_items WHERE project_id=?")
      .bind(projectId).all<Row>();
    parts.results = projectEvidenceRows(parts.results, projection.part);
    total += parts.results.length;
    const records = await database.prepare(`SELECT r.*,d.id AS evidence_id FROM npd_inspection_records r
      LEFT JOIN npd_documents d ON d.id=r.document_id AND d.project_id=r.project_id
        AND d.sheet_code='quality_inspection'
      WHERE r.project_id=? ORDER BY r.created_at DESC,r.rowid DESC`).bind(projectId).all<Row>();
    if (pending) records.results.unshift(pending);
    const targets = [
      ...motors.results.map((row) => ({ row, type: "motor", label: row.model })),
      ...parts.results.map((row) => ({ row, type: "part", label: `${row.part_no} ${row.name}` })),
    ];
    for (const { row, type, label } of targets) {
      const record = records.results.find((item) => item.item_type === type &&
        (type === "motor" ? item.motor_id === row.id && !item.part_item_id : item.part_item_id === row.id && !item.motor_id) &&
        Number(item.requirement_revision) === Number(row.design_revision));
      const problems = inspectionEvidenceIssues(String(row.inspection_requirement || ""), record ? {
        result: String(record.result), hasAttachment: Boolean(record.evidence_id), conclusion: String(record.conclusion || ""),
        requirement: String(record.inspection_requirement || ""),
      } : undefined);
      if (record?.evidence_id) documentIds.push(String(record.evidence_id));
      if (problems.length) issues.push(`${label}：${problems.join("、")}`);
      else completed++;
    }
  }
  return { completed, total, issues, documentIds };
}

async function productionNodeProgress(database: D1Database, projectId: string, projection: { motor?: Row; part?: Row } = {}) {
  const [motorRows, partRows] = await Promise.all([
    database.prepare("SELECT * FROM npd_project_motors WHERE project_id=?").bind(projectId).all<Row>(),
    database.prepare("SELECT * FROM npd_part_items WHERE project_id=?").bind(projectId).all<Row>(),
  ]);
  const motors = projectEvidenceRows(motorRows.results, projection.motor);
  const parts = projectEvidenceRows(partRows.results, projection.part);
  const rows = [...motors, ...parts];
  const issues = rows.filter((row) => row.status !== "completed" || !validDate(String(row.actual_date || "")) || !row.confirmed_by || !row.confirmed_at)
    .map((row) => `${row.model || `${row.part_no} ${row.name}`} · R${row.design_revision || 1}`);
  const total = rows.length, completed = total - issues.length;
  return { total, completed, motorCount: motors.length, partCount: parts.length, issues,
    progress: total ? Math.round(completed / total * 90) : 0 };
}

function projectEvidenceRows(rows: Row[], replacement?: Row): Row[] {
  if (!replacement) return rows;
  return [...rows.filter((row) => row.id !== replacement.id), replacement];
}

// Read a projected post-change view while the revision context still guards all
// contributing stage versions. The mutation, these derived revisions, snapshots
// and project total commit in one batch; never repair progress in a later write.
async function designChangeProgress(database: D1Database, projectId: string, projection: { motor?: Row; part?: Row }) {
  const codes: ("verification" | "quality_inspection")[] = projection.motor
    ? ["verification", "quality_inspection"] : ["quality_inspection"];
  const relatedProgress: NonNullable<SheetRevisionChange["relatedProgress"]> = [];
  for (const code of codes) {
    const evidence = await getStageEvidence(database, projectId, code, undefined, projection);
    relatedProgress.push({ code, progress: evidence.total ? Math.round(evidence.completed / evidence.total * 90) : 0,
      note: `当前版次证据齐套 ${evidence.completed}/${evidence.total}；${evidence.issues.length
        ? `证据待补齐：${evidence.issues.join("；")}` : "附件索引齐套，阶段放行仍需复核并核验原件。"}` });
  }
  const production = await productionNodeProgress(database, projectId, projection);
  const partsProgress = production.progress;
  if (projection.motor) relatedProgress.push({ code: "parts_plan", progress: partsProgress,
    note: `整机及零部件生产确认 ${production.completed}/${production.total}；设计改版或新增规格需重新确认，历史记录保留。` });
  return { relatedProgress, partsProgress };
}

async function updateSpecialSheetProgress(
  database: D1Database,
  projectId: string,
  sheetCode: "parts_plan" | "verification" | "quality_inspection",
  userId: string,
  change: SheetRevisionChange,
  pending: Row,
) {
  let completed = 0;
  let total = 0;
  let evidenceNote: string | undefined;
  if (sheetCode === "parts_plan") {
    ({ completed, total } = await productionNodeProgress(database, projectId));
  } else {
    const evidence = await getStageEvidence(database, projectId, sheetCode, pending);
    ({ completed, total } = evidence);
    evidenceNote = evidence.issues.length ? `证据待补齐：${evidence.issues.join("；")}` : "当前设计版次的报告记录及附件索引已齐套，阶段放行时还将核验原件。";
  }
  const progress = total ? Math.min(90, Math.round((completed / total) * 90)) : 0;
  await reviseProjectSheet(database, projectId, sheetCode, userId, {
    reason: "新增或更新执行记录", status: "in_progress", progress,
    note: evidenceNote,
    ...change,
    snapshot: { completed, total, ...change.snapshot },
  }, true);
}

async function recalculateProject(database: D1Database, projectId: string) {
  const sheets = await database.prepare(`SELECT code,status,progress,sort_order
    FROM npd_project_sheets WHERE project_id=? ORDER BY sort_order`).bind(projectId).all<Row>();
  if (!sheets.results.length) return;
  const progress = Math.round(
    sheets.results.reduce((sum, row) => sum + Number(row.progress || 0), 0) /
      sheets.results.length,
  );
  const current = sheets.results.find((row) => row.status !== "completed") || sheets.results.at(-1);
  const completed = sheets.results.every((row) => row.status === "completed");
  const existing = await database.prepare("SELECT status FROM npd_projects WHERE id=?")
    .bind(projectId).first<{ status: string }>();
  const protectedStatus = existing?.status === "paused" || existing?.status === "cancelled";
  const status = protectedStatus ? existing?.status : completed ? "completed" : "active";
  await database.prepare(`UPDATE npd_projects SET progress=?,current_sheet_code=?,
    lifecycle_version=lifecycle_version+CASE WHEN status<>? THEN 1 ELSE 0 END,status=?,
    actual_end=CASE WHEN ?='completed' THEN COALESCE(actual_end,?) ELSE NULL END,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      completed ? 100 : progress, String(current?.code || "change_archive"), status, status,
      status, currentDateIso(), projectId,
    ).run();
}

async function assertDocumentLink(
  database: D1Database,
  documentId: string | null,
  projectId: string,
  sheetCode: SheetCode,
  motorId?: string | null,
) {
  if (!documentId) return;
  const row = await database.prepare(
    "SELECT id,motor_id,linked_record_id FROM npd_documents WHERE id=? AND project_id=? AND sheet_code=?",
  ).bind(documentId, projectId, sheetCode).first<Row>();
  if (!row) throw new Error("附件不存在或不属于当前项目阶段。");
  if (row.motor_id && row.motor_id !== motorId) throw new Error("附件关联的电机规格与本次记录不一致。");
  if (row.linked_record_id) throw new Error("该附件已关联其他记录，请上传本次记录对应的附件。");
}

async function addActivity(
  database: D1Database,
  projectId: string | null,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: string,
) {
  await database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,?,?,?,?,?)`).bind(
    makeId("activity"), projectId, actorId, action, entityType, entityId, detail,
  ).run();
}

function normalizeRole(value: unknown): NpdRole {
  const role = String(value || "sales");
  return ["admin", "sales", "design", "process", "procurement", "production", "tester", "quality"].includes(role)
    ? role as NpdRole
    : "sales";
}

function isNpdRole(value: unknown): value is NpdRole {
  return ["admin", "sales", "design", "process", "procurement", "production", "tester", "quality"].includes(String(value));
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidAccountEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function assertValidPassword(password: string) {
  if (password.length < 8 || password.length > 128 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("本地登录密码需为 8～128 位，并同时包含字母和数字。");
  }
}

async function createPasswordCredentials(password: string, existingSalt?: string) {
  assertValidPassword(password);
  const salt = existingSalt || randomHex(16);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", iterations: 120_000,
    salt: hexBytes(salt),
  }, key, 256);
  return { salt, hash: bytesHex(new Uint8Array(bits)) };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesHex(new Uint8Array(digest));
}

function randomHex(length: number) {
  return bytesHex(crypto.getRandomValues(new Uint8Array(length)));
}

function bytesHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) throw new Error("本地账户凭据无效。");
  return new Uint8Array(value.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) || []);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function sqliteTimestamp(date: Date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function assertActive(user: NpdUser) {
  if (!user.active) throw new Error("当前账号已停用，请联系管理员。");
}

function currentDateIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function interpolateDate(start: string, end: string, ratio: number) {
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  return new Date(startMs + (endMs - startMs) * ratio).toISOString().slice(0, 10);
}

function validDate(value: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function initials(name: string) {
  const compact = name.replace(/\s+/g, "");
  return compact.slice(Math.max(0, compact.length - 2));
}

function sheetStatusText(status: SheetStatus) {
  return status === "completed" ? "已完成" : status === "pending_review" ? "待确认" :
    status === "blocked" ? "受阻" : status === "in_progress" ? "进行中" : "未开始";
}
