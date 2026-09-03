import { env } from "cloudflare:workers";
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
import { formDefinitions } from "../lib/forms";
import {
  formToSheet,
  sheetByCode,
  sheetDefinitions,
  sheetScheduleRatios,
} from "../lib/sheets-v2";

type Row = Record<string, string | number | null>;
type RuntimeEnv = { DB?: D1Database; FILES?: R2Bucket };

const defaultDashboardPreference: DashboardPreference = {
  periodMode: "year",
  periodValue: String(new Date().getFullYear()),
  customStart: "",
  customEnd: "",
  visibleMetrics: [
    "total",
    "active",
    "completed",
    "onTime",
    "overdue",
    "motors",
    "averageProgress",
    "highRisk",
  ],
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
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      department TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      bootstrap_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      mounting TEXT NOT NULL DEFAULT '', quantity INTEGER NOT NULL DEFAULT 1,
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
      confirmed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
      inspector_id TEXT NOT NULL REFERENCES npd_users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  ];

  await database.batch(schemaStatements.map((sql) => database.prepare(sql)));
  const count = await database
    .prepare("SELECT COUNT(*) AS count FROM npd_projects")
    .first<{ count: number }>();
  if (!count?.count) await seedNpdDatabase(database);
  await repairDemoConsistency(database);
  await database.prepare("PRAGMA optimize").run();
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
    database.prepare(`INSERT INTO npd_activities
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
    "INSERT INTO npd_users (id,email,name,department,role) VALUES (?,?,?,?,?)",
  ).bind(...row)));
  customers.forEach((row) => statements.push(database.prepare(
    "INSERT INTO npd_customers (id,code,name,industry,contact,phone) VALUES (?,?,?,?,?,?)",
  ).bind(...row)));
  projects.forEach((row) => statements.push(database.prepare(`INSERT INTO npd_projects (
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
  await database.batch(orderRows.map((row) => database.prepare(`INSERT INTO npd_sales_orders (
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
        "INSERT INTO npd_project_members (id,project_id,user_id,responsibility) VALUES (?,?,?,?)",
      ).bind(makeId("mem"), projectId, userId, responsibility));
    }
  }
  await database.batch(statements);
}

async function seedMotors(database: D1Database, today: string) {
  const rows = [
    ["npd-m-001", "npd-p-001", "HE5-132S-4", "HD26-1324", "5.5kW", "380V", "50Hz", "4", "1450r/min", "132S", "B3", 2, "效率、温升、噪声、振动及装配尺寸全检", "型式试验：效率、温升、堵转、最大转矩、超速", addDays(today, -10), addDays(today, -11), "completed"],
    ["npd-m-002", "npd-p-001", "HE5-160M-4", "HD26-1604", "11kW", "380V", "50Hz", "4", "1465r/min", "160M", "B3", 2, "效率、温升、噪声、振动及装配尺寸全检", "型式试验：效率、温升、堵转、最大转矩、超速", addDays(today, 4), null, "in_progress"],
    ["npd-m-003", "npd-p-001", "HE5-180M-4", "HD26-1804", "18.5kW", "380V", "50Hz", "4", "1470r/min", "180M", "B3", 1, "效率、温升、噪声、振动及装配尺寸全检", "型式试验：效率、温升、堵转、最大转矩、超速", addDays(today, 12), null, "planned"],
    ["npd-m-004", "npd-p-002", "YVF2-250M-6", "HD26-2506", "37kW", "380V", "50Hz", "6", "985r/min", "250M", "B3", 1, "制动器接口、盐雾防护、轴伸尺寸和动平衡", "低频转矩、频繁制动热容量、盐雾与振动试验", addDays(today, 18), null, "in_progress"],
    ["npd-m-005", "npd-p-002", "YVF2-280S-6", "HD26-2806", "45kW", "380V", "50Hz", "6", "990r/min", "280S", "B3", 1, "制动器接口、盐雾防护、轴伸尺寸和动平衡", "低频转矩、频繁制动热容量、盐雾与振动试验", addDays(today, 28), null, "planned"],
    ["npd-m-006", "npd-p-003", "YKK-355M-4", "HD26-3554", "250kW", "6000V", "50Hz", "4", "1490r/min", "355M", "IMB3", 1, "高温绝缘体系、轴承游隙、冷却风路和防护等级", "高温环境温升、绝缘寿命、振动及噪声试验", addDays(today, 58), null, "planned"],
    ["npd-m-007", "npd-p-004", "YE4-112M-4", "HD26-1124", "4kW", "380V", "50Hz", "4", "1440r/min", "112M", "B3", 2, "效率和材料替代专项检验", "效率与温升对比验证", addDays(today, -85), addDays(today, -88), "completed"],
  ];
  await database.batch(rows.map((row) => database.prepare(`INSERT INTO npd_project_motors (
    id,project_id,model,motor_code,rated_power,voltage,frequency,poles,speed,frame_size,
    mounting,quantity,inspection_requirement,test_requirement,planned_date,actual_date,status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...row)));
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
      statements.push(database.prepare(`INSERT INTO npd_project_sheets (
        id,project_id,code,title,sort_order,owner_role,status,progress,planned_date,
        actual_date,version,note,updated_by
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        makeId("sheet"), projectId, sheet.code, sheet.title, sheet.index,
        sheet.ownerRole, status, status === "completed" ? 100 : status === "in_progress" ? Number(project[12]) % 80 + 15 : 0,
        plannedDate, status === "completed" ? addDays(plannedDate, -1) : null,
        1, status === "in_progress" ? "当前阶段正在按计划推进。" : "", "npd-u-design",
      ));
      if (status === "completed") {
        sheet.formCodes.forEach((formCode) => {
          statements.push(database.prepare(`INSERT INTO npd_form_records
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
  await database.batch(parts.map((row) => database.prepare(`INSERT INTO npd_part_items (
    id,project_id,motor_id,part_no,name,specification,material,quantity,source_type,
    design_output_ref,inspection_requirement,test_requirement,planned_date,actual_date,
    status,confirmed_by,confirmed_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...row)));

  await database.prepare(`INSERT INTO npd_test_reports (
    id,project_id,motor_id,report_no,report_type,title,requirement_ref,test_date,
    result,conclusion,document_id,submitted_by
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    "npd-test-001", "npd-p-001", "npd-m-001", "TR-2026-081",
    "型式试验", "HE5-132S-4 型式试验报告", "DO-HE5-132-TEST",
    addDays(today, -12), "合格", "效率、温升和堵转指标满足设计输入。", null,
    "npd-u-tester",
  ).run();
  await database.prepare(`INSERT INTO npd_inspection_records (
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

  let row = await database
    .prepare("SELECT * FROM npd_users WHERE lower(email)=lower(?)")
    .bind(email)
    .first<Row>();
  if (!row) {
    const bootstrap = await database
      .prepare("SELECT COUNT(*) AS count FROM npd_users WHERE bootstrap_admin=1")
      .first<{ count: number }>();
    if (bootstrap?.count) {
      throw new Error("账号尚未开通，请联系管理员在人员与权限中创建账户。");
    }
    const role: NpdRole = "admin";
    const id = makeId("user");
    await database.prepare(`INSERT INTO npd_users
      (id,email,name,department,role,active,bootstrap_admin)
      VALUES (?,?,?,?,?,1,?)`).bind(
      id,
      email,
      fullName?.trim() || email.split("@")[0],
      "系统管理",
      role,
      1,
    ).run();
    row = await database
      .prepare("SELECT * FROM npd_users WHERE id=?")
      .bind(id)
      .first<Row>();
  }
  if (!row) throw new Error("用户初始化失败。");
  if (!Boolean(row.active)) throw new Error("当前账号已停用，请联系管理员。");
  return mapUser(row);
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
    formResult,
    partResult,
    testResult,
    inspectionResult,
    documentResult,
    activityResult,
    preferenceRow,
  ] = await Promise.all([
    database.prepare(`SELECT p.*, c.name AS customer_name,
      initiator.name AS initiator_name, owner.name AS owner_name
      FROM npd_projects p
      JOIN npd_customers c ON c.id=p.customer_id
      JOIN npd_users initiator ON initiator.id=p.initiator_id
      JOIN npd_users owner ON owner.id=p.owner_id
      ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1
        WHEN 'paused' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
        p.updated_at DESC`).all<Row>(),
    database.prepare(`SELECT o.*, c.name AS customer_name, p.code AS project_code,
      u.name AS created_by_name FROM npd_sales_orders o
      JOIN npd_customers c ON c.id=o.customer_id
      LEFT JOIN npd_projects p ON p.id=o.project_id
      JOIN npd_users u ON u.id=o.created_by
      ORDER BY o.order_date DESC, o.order_no DESC`).all<Row>(),
    database.prepare("SELECT * FROM npd_customers ORDER BY name").all<Row>(),
    database.prepare("SELECT * FROM npd_users ORDER BY active DESC, role, name").all<Row>(),
    database.prepare(`SELECT m.*, u.name AS user_name, u.role AS user_role
      FROM npd_project_members m JOIN npd_users u ON u.id=m.user_id
      ORDER BY m.created_at`).all<Row>(),
    database.prepare("SELECT * FROM npd_project_motors ORDER BY project_id, model").all<Row>(),
    database.prepare(`SELECT s.*, u.name AS updated_by_name
      FROM npd_project_sheets s LEFT JOIN npd_users u ON u.id=s.updated_by
      ORDER BY s.project_id, s.sort_order`).all<Row>(),
    database.prepare(`SELECT f.*, u.name AS updated_by_name
      FROM npd_form_records f LEFT JOIN npd_users u ON u.id=f.updated_by
      ORDER BY f.project_id, f.sheet_code, f.form_code`).all<Row>(),
    database.prepare(`SELECT p.*, m.model AS motor_model, u.name AS confirmed_by_name
      FROM npd_part_items p
      LEFT JOIN npd_project_motors m ON m.id=p.motor_id
      LEFT JOIN npd_users u ON u.id=p.confirmed_by
      ORDER BY p.project_id, p.planned_date, p.part_no`).all<Row>(),
    database.prepare(`SELECT t.*, m.model AS motor_model, u.name AS submitted_by_name,
      d.file_name AS file_name
      FROM npd_test_reports t
      JOIN npd_project_motors m ON m.id=t.motor_id
      JOIN npd_users u ON u.id=t.submitted_by
      LEFT JOIN npd_documents d ON d.id=t.document_id
      ORDER BY t.test_date DESC`).all<Row>(),
    database.prepare(`SELECT i.*, m.model AS motor_model, p.name AS part_name,
      u.name AS inspector_name, d.file_name AS file_name
      FROM npd_inspection_records i
      LEFT JOIN npd_project_motors m ON m.id=i.motor_id
      LEFT JOIN npd_part_items p ON p.id=i.part_item_id
      JOIN npd_users u ON u.id=i.inspector_id
      LEFT JOIN npd_documents d ON d.id=i.document_id
      ORDER BY i.inspection_date DESC`).all<Row>(),
    database.prepare(`SELECT d.*, u.name AS uploaded_by_name
      FROM npd_documents d LEFT JOIN npd_users u ON u.id=d.uploaded_by
      ORDER BY d.created_at DESC`).all<Row>(),
    database.prepare(`SELECT a.*, p.code AS project_code, u.name AS actor_name
      FROM npd_activities a
      LEFT JOIN npd_projects p ON p.id=a.project_id
      JOIN npd_users u ON u.id=a.actor_id
      ORDER BY a.created_at DESC LIMIT 300`).all<Row>(),
    database.prepare("SELECT payload FROM npd_dashboard_preferences WHERE user_id=?")
      .bind(currentUser.id).first<{ payload: string }>(),
  ]);

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
      overdueDays: project.status === "completed" || project.plannedEnd >= currentDateIso()
        ? 0
        : dateDiffDays(project.plannedEnd, currentDateIso()),
    };
  });

  let dashboardPreference = defaultDashboardPreference;
  if (preferenceRow?.payload) {
    try {
      dashboardPreference = {
        ...defaultDashboardPreference,
        ...(JSON.parse(preferenceRow.payload) as Partial<DashboardPreference>),
      };
    } catch {
      dashboardPreference = defaultDashboardPreference;
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
    formRecords: forms,
    parts: partResult.results.map(mapPart).filter((row) => visibleIds.has(row.projectId)),
    testReports: testResult.results.map(mapTestReport).filter((row) => visibleIds.has(row.projectId)),
    inspections: inspectionResult.results.map(mapInspection).filter((row) => visibleIds.has(row.projectId)),
    documents: documentResult.results.map(mapDocument).filter((row) => visibleIds.has(row.projectId)),
    activities: activityResult.results.map(mapActivity).filter(
      (row) => !row.projectId || visibleIds.has(row.projectId),
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
    id: String(row.id), projectId: String(row.project_id), userId: String(row.user_id),
    userName: String(row.user_name || ""), role, roleLabel: roleLabels[role],
    responsibility: String(row.responsibility), createdAt: String(row.created_at),
  };
}

function mapMotor(row: Row): ProjectMotor {
  return {
    id: String(row.id), projectId: String(row.project_id), model: String(row.model),
    motorCode: String(row.motor_code || ""), ratedPower: String(row.rated_power || ""),
    voltage: String(row.voltage || ""), frequency: String(row.frequency || ""),
    poles: String(row.poles || ""), speed: String(row.speed || ""),
    frameSize: String(row.frame_size || ""), mounting: String(row.mounting || ""),
    quantity: Number(row.quantity || 1), inspectionRequirement: String(row.inspection_requirement || ""),
    testRequirement: String(row.test_requirement || ""), plannedDate: String(row.planned_date),
    actualDate: row.actual_date ? String(row.actual_date) : null, status: String(row.status),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
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
    submittedByName: String(row.submitted_by_name || ""), createdAt: String(row.created_at),
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
    inspectorName: String(row.inspector_name || ""), createdAt: String(row.created_at),
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
  productionId: string;
  testerId: string;
  qualityId: string;
  plannedStart: string;
  plannedEnd: string;
  priority: string;
  riskLevel: RiskLevel;
  description: string;
  orderIds?: string[];
  motors: Array<{
    model: string;
    motorCode: string;
    ratedPower: string;
    voltage: string;
    frequency: string;
    poles: string;
    speed: string;
    frameSize: string;
    mounting: string;
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
  const models = input.motors.map((motor) => motor.model.trim()).filter(Boolean);
  if (models.length !== input.motors.length || new Set(models).size !== models.length) {
    throw new Error("每个电机规格必须填写唯一型号。");
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
    const linkedOrders = await database.prepare(`SELECT id,customer_id,project_id
      FROM npd_sales_orders WHERE id IN (${placeholders})`).bind(...orderIds).all<Row>();
    if (linkedOrders.results.length !== orderIds.length) throw new Error("关联订单不存在。");
    if (linkedOrders.results.some((order) => order.project_id)) {
      throw new Error("所选订单中存在已关联项目的订单。");
    }
    if (linkedOrders.results.some((order) => order.customer_id !== input.customerId)) {
      throw new Error("销售订单客户必须与项目客户一致。");
    }
  }

  const id = makeId("project");
  const code = await nextProjectCode(database);
  const statements: D1PreparedStatement[] = [
    database.prepare(`INSERT INTO npd_projects (
      id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,
      status,risk_level,current_sheet_code,progress,planned_start,planned_end,
      priority,description
    ) VALUES (?,?,?,?,?,?,?,?,?,'active',?,'initiation',0,?,?,?,?)`).bind(
      id, code, input.name.trim(), input.seriesName.trim(), input.category,
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
      frame_size,mounting,quantity,inspection_requirement,test_requirement,
      planned_date,status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned')`).bind(
      makeId("motor"), id, motor.model.trim(), motor.motorCode?.trim() || "",
      motor.ratedPower?.trim() || "", motor.voltage?.trim() || "",
      motor.frequency?.trim() || "50Hz", motor.poles?.trim() || "",
      motor.speed?.trim() || "", motor.frameSize?.trim() || "",
      motor.mounting?.trim() || "", Math.max(1, Number(motor.quantity || 1)),
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
  orderIds.forEach((orderId) => statements.push(
    database.prepare(`UPDATE npd_sales_orders SET project_id=?,status='in_development',
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id IS NULL`).bind(id, orderId),
  ));
  statements.push(database.prepare(`INSERT INTO npd_activities
    (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,?,?,?,?,?)`).bind(
    makeId("activity"), id, currentUser.id, "创建项目", "project", id,
    `${code} 已由 ${currentUser.name} 发起，项目负责人为 ${owner.name}，包含 ${input.motors.length} 个电机规格。`,
  ));
  await database.batch(statements);
  return { id, code };
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
  const database = getDatabase();
  const customer = await database.prepare("SELECT id FROM npd_customers WHERE id=?")
    .bind(input.customerId).first<Row>();
  if (!customer) throw new Error("订单客户不存在。");
  const duplicate = await database.prepare("SELECT id FROM npd_sales_orders WHERE lower(order_no)=lower(?)")
    .bind(input.orderNo.trim()).first<Row>();
  if (duplicate) throw new Error("订单号已存在。");
  const id = makeId("order");
  await database.prepare(`INSERT INTO npd_sales_orders (
    id,order_no,customer_id,project_id,product_summary,quantity,amount,currency,
    order_date,delivery_date,status,created_by
  ) VALUES (?,?,?,NULL,?,?,?,?,? ,?,'confirmed',?)`).bind(
    id, input.orderNo.trim(), input.customerId, input.productSummary.trim(),
    Math.max(1, Number(input.quantity || 1)), Math.max(0, Number(input.amount || 0)),
    input.currency || "CNY", input.orderDate, input.deliveryDate, currentUser.id,
  ).run();
  await addActivity(database, null, currentUser.id, "录入销售订单", "sales_order", id,
    `${input.orderNo.trim()} 已录入，待关联新品项目。`);
  return { id };
}

export async function linkNpdSalesOrder(
  orderId: string,
  projectId: string | null,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  const database = getDatabase();
  const order = await database.prepare("SELECT * FROM npd_sales_orders WHERE id=?")
    .bind(orderId).first<Row>();
  if (!order) throw new Error("销售订单不存在。");
  const accessProjectId = projectId || (order.project_id ? String(order.project_id) : null);
  let project: NpdProject | null = null;
  if (accessProjectId) project = await assertProjectAccess(database, currentUser, accessProjectId);
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
  await database.prepare(`UPDATE npd_sales_orders SET project_id=?,status=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
    projectId, projectId ? "in_development" : "confirmed", orderId,
  ).run();
  await addActivity(database, projectId || (order.project_id ? String(order.project_id) : null),
    currentUser.id, projectId ? "关联销售订单" : "解除订单关联", "sales_order", orderId,
    `${String(order.order_no)} ${projectId ? `已关联项目 ${project?.code}` : "已解除项目关联"}。`);
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
  if (!input.model?.trim() || !validDate(input.plannedDate)) {
    throw new Error("电机型号和计划完成日期为必填项。");
  }
  const duplicate = await database.prepare(
    "SELECT id FROM npd_project_motors WHERE project_id=? AND lower(model)=lower(?)",
  ).bind(projectId, input.model.trim()).first<Row>();
  if (duplicate) throw new Error("该项目下已存在同型号电机规格。");
  const id = makeId("motor");
  await database.prepare(`INSERT INTO npd_project_motors (
    id,project_id,model,motor_code,rated_power,voltage,frequency,poles,speed,
    frame_size,mounting,quantity,inspection_requirement,test_requirement,
    planned_date,status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned')`).bind(
    id, projectId, input.model.trim(), input.motorCode?.trim() || "",
    input.ratedPower?.trim() || "", input.voltage?.trim() || "",
    input.frequency?.trim() || "50Hz", input.poles?.trim() || "",
    input.speed?.trim() || "", input.frameSize?.trim() || "",
    input.mounting?.trim() || "", Math.max(1, Number(input.quantity || 1)),
    input.inspectionRequirement?.trim() || "", input.testRequirement?.trim() || "",
    input.plannedDate,
  ).run();
  await addActivity(database, projectId, currentUser.id, "增加电机规格", "motor", id,
    `新增规格 ${input.model.trim()}，计划完成日期 ${input.plannedDate}。`);
  return { id };
}

export async function updateMotorRequirements(
  motorId: string,
  inspectionRequirement: string,
  testRequirement: string,
  currentUser: NpdUser,
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
  if (!inspectionRequirement.trim() || !testRequirement.trim()) {
    throw new Error("检验要求和试验要求均不能为空。");
  }
  await database.prepare(`UPDATE npd_project_motors SET
    inspection_requirement=?, test_requirement=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .bind(inspectionRequirement.trim(), testRequirement.trim(), motorId).run();
  await addActivity(database, String(motor.project_id), currentUser.id, "更新设计输出要求", "motor", motorId,
    `${String(motor.model)} 的检验要求和试验要求已更新。`);
}

export async function saveNpdFormRecord(
  projectId: string,
  formCode: string,
  payload: Record<string, unknown>,
  submit: boolean,
  currentUser: NpdUser,
) {
  const sheetCode = formToSheet[formCode];
  if (!sheetCode) throw new Error("表单未映射到开发阶段 Sheet。");
  const definition = formDefinitions.find((form) => form.code === formCode);
  if (!definition) throw new Error("表单定义不存在。");
  const { database, project } = await getEditableProject(projectId, currentUser);
  if (!canEditSheet(currentUser, project, sheetCode)) {
    throw new Error(`当前角色无权编辑“${sheetByCode[sheetCode].title}”。`);
  }
  if (submit) {
    const missing = definition.fields.filter((field) => {
      if (!field.required) return false;
      const value = payload[field.key];
      return value === undefined || value === null || value === "" ||
        (Array.isArray(value) && value.length === 0);
    });
    if (missing.length) {
      throw new Error(`提交前请完成：${missing.map((field) => field.label).join("、")}。`);
    }
  }
  const existing = await database.prepare(
    "SELECT id,version FROM npd_form_records WHERE project_id=? AND form_code=?",
  ).bind(projectId, formCode).first<{ id: string; version: number }>();
  const status = submit ? "submitted" : "draft";
  const serialized = JSON.stringify(payload);
  let id = existing?.id;
  if (existing) {
    await database.prepare(`UPDATE npd_form_records SET status=?, payload=?,
      version=?, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      status, serialized, submit ? existing.version + 1 : existing.version,
      currentUser.id, existing.id,
    ).run();
  } else {
    id = makeId("form");
    await database.prepare(`INSERT INTO npd_form_records
      (id,project_id,form_code,sheet_code,status,version,payload,updated_by)
      VALUES (?,?,?,?,?,1,?,?)`).bind(
      id, projectId, formCode, sheetCode, status, serialized, currentUser.id,
    ).run();
  }
  const sheetForms = sheetByCode[sheetCode].formCodes;
  const submitted = await database.prepare(`SELECT COUNT(*) AS count FROM npd_form_records
    WHERE project_id=? AND sheet_code=? AND status='submitted'`).bind(projectId, sheetCode)
    .first<{ count: number }>();
  const sheetStatus = submit && submitted?.count === sheetForms.length
    ? "pending_review"
    : "in_progress";
  const sheetProgress = sheetForms.length
    ? Math.min(90, Math.round(((submitted?.count || 0) / sheetForms.length) * 90))
    : 10;
  await database.prepare(`UPDATE npd_project_sheets SET status=?,progress=?,
    updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND code=?`)
    .bind(sheetStatus, sheetProgress, currentUser.id, projectId, sheetCode).run();
  await addActivity(database, projectId, currentUser.id,
    submit ? "提交阶段表单" : "保存阶段表单", "form", id || null,
    `${definition.name} ${submit ? "已提交" : "已保存草稿"}。`);
  await recalculateProject(database, projectId);
  return { id };
}

export async function updateProjectSheet(
  projectId: string,
  sheetCode: SheetCode,
  input: { status: SheetStatus; progress: number; plannedDate: string; note: string },
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(projectId, currentUser);
  if (!canEditSheet(currentUser, project, sheetCode)) {
    throw new Error(`当前角色无权更新“${sheetByCode[sheetCode].title}”。`);
  }
  if (!validDate(input.plannedDate) || input.progress < 0 || input.progress > 100) {
    throw new Error("请填写有效的计划日期和 0～100 的完成度。");
  }
  if (input.status === "completed") {
    await validateSheetCompletion(database, projectId, sheetCode);
  }
  const actualDate = input.status === "completed" ? currentDateIso() : null;
  const progress = input.status === "completed" ? 100 : Math.round(input.progress);
  await database.prepare(`UPDATE npd_project_sheets SET status=?,progress=?,
    planned_date=?,actual_date=?,note=?,version=CASE WHEN status!='completed' AND ?='completed'
      THEN version+1 ELSE version END,updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE project_id=? AND code=?`).bind(
      input.status, progress, input.plannedDate, actualDate, input.note.trim(),
      input.status, currentUser.id, projectId, sheetCode,
    ).run();
  await addActivity(database, projectId, currentUser.id, "更新阶段 Sheet", "sheet", sheetCode,
    `${sheetByCode[sheetCode].title} 更新为“${sheetStatusText(input.status)}”，完成度 ${progress}%。`);
  await recalculateProject(database, projectId);
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
    currentUser.role !== "production" && !isProjectSteward(currentUser, project)
  ) {
    throw new Error("只有设计、生产、项目负责人或管理员可以新增零部件。");
  }
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
  const id = makeId("part");
  await database.prepare(`INSERT INTO npd_part_items (
    id,project_id,motor_id,part_no,name,specification,material,quantity,source_type,
    design_output_ref,inspection_requirement,test_requirement,planned_date,status
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'planned')`).bind(
    id, input.projectId, input.motorId, input.partNo.trim(), input.name.trim(),
    input.specification?.trim() || "", input.material?.trim() || "",
    Math.max(1, Number(input.quantity || 1)), input.sourceType || "自制",
    input.designOutputRef.trim(), input.inspectionRequirement.trim(),
    input.testRequirement?.trim() || "", input.plannedDate,
  ).run();
  await database.prepare(`UPDATE npd_project_sheets SET status='in_progress',
    progress=MAX(progress,10),updated_by=?,updated_at=CURRENT_TIMESTAMP
    WHERE project_id=? AND code='parts_plan'`).bind(currentUser.id, input.projectId).run();
  await addActivity(database, input.projectId, currentUser.id, "新增零部件", "part", id,
    `${input.partNo.trim()} ${input.name.trim()} 已加入节点计划，检验要求关联 ${input.designOutputRef.trim()}。`);
  await recalculateProject(database, input.projectId);
  return { id };
}

export async function confirmPartItem(
  partId: string,
  status: "in_progress" | "completed" | "blocked",
  note: string,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  const database = getDatabase();
  const part = await database.prepare("SELECT * FROM npd_part_items WHERE id=?")
    .bind(partId).first<Row>();
  if (!part) throw new Error("零部件记录不存在。");
  await assertProjectAccess(database, currentUser, String(part.project_id));
  if (currentUser.role !== "admin" && currentUser.role !== "production") {
    throw new Error("只有生产或管理员可以确认整机及零部件完成节点。");
  }
  const actualDate = status === "completed" ? currentDateIso() : null;
  await database.prepare(`UPDATE npd_part_items SET status=?,actual_date=?,confirmed_by=?,
    confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
    status, actualDate, currentUser.id, partId,
  ).run();
  await addActivity(database, String(part.project_id), currentUser.id, "确认零部件节点", "part", partId,
    `${String(part.part_no)} ${String(part.name)} 更新为 ${status === "completed" ? "已完成" : status === "blocked" ? "受阻" : "进行中"}${note.trim() ? `：${note.trim()}` : ""}。`);
  await updateSpecialSheetProgress(database, String(part.project_id), "parts_plan", currentUser.id);
}

export async function createTestReport(
  input: {
    projectId: string;
    motorId: string;
    reportNo: string;
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
  await assertDocumentLink(database, input.documentId, input.projectId, "verification");
  const id = makeId("test");
  await database.prepare(`INSERT INTO npd_test_reports (
    id,project_id,motor_id,report_no,report_type,title,requirement_ref,test_date,
    result,conclusion,document_id,submitted_by
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, input.projectId, input.motorId, input.reportNo.trim(), input.reportType,
    input.title.trim(), input.requirementRef.trim(), input.testDate, input.result,
    input.conclusion?.trim() || "", input.documentId, currentUser.id,
  ).run();
  if (input.documentId) {
    await database.prepare(`UPDATE npd_documents SET linked_record_id=?,kind='test_report',
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id, input.documentId).run();
  }
  await addActivity(database, input.projectId, currentUser.id, "提交试验报告", "test_report", id,
    `${String(motor.model)} · ${input.reportNo.trim()} · ${input.result}。`);
  await updateSpecialSheetProgress(database, input.projectId, "verification", currentUser.id);
  return { id };
}

export async function createInspectionRecord(
  input: {
    projectId: string;
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
  if (!validDate(input.inspectionDate) || !input.result) {
    throw new Error("检验日期和检验结果为必填项。");
  }
  let requirement = "";
  let designOutputRef = "";
  let itemName = "";
  if (input.itemType === "motor") {
    if (!input.motorId) throw new Error("请选择待检验的整机规格。");
    const motor = await database.prepare(
      "SELECT * FROM npd_project_motors WHERE id=? AND project_id=?",
    ).bind(input.motorId, input.projectId).first<Row>();
    if (!motor) throw new Error("整机规格不存在。");
    requirement = String(motor.inspection_requirement || "").trim();
    designOutputRef = `电机设计输出 · ${String(motor.model)}`;
    itemName = String(motor.model);
  } else {
    if (!input.partItemId) throw new Error("请选择待检验的零部件。");
    const part = await database.prepare(
      "SELECT * FROM npd_part_items WHERE id=? AND project_id=?",
    ).bind(input.partItemId, input.projectId).first<Row>();
    if (!part) throw new Error("零部件不存在。");
    requirement = String(part.inspection_requirement || "").trim();
    designOutputRef = String(part.design_output_ref || "").trim();
    itemName = `${String(part.part_no)} ${String(part.name)}`;
  }
  if (!requirement || !designOutputRef) {
    throw new Error("该对象尚未在设计输出中配置检验要求，不能提交检验记录。");
  }
  await assertDocumentLink(database, input.documentId, input.projectId, "quality_inspection");
  const id = makeId("inspection");
  await database.prepare(`INSERT INTO npd_inspection_records (
    id,project_id,motor_id,part_item_id,item_type,inspection_requirement,
    design_output_ref,inspection_date,result,conclusion,document_id,inspector_id
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, input.projectId, input.motorId, input.partItemId, input.itemType,
    requirement, designOutputRef, input.inspectionDate, input.result,
    input.conclusion?.trim() || "", input.documentId, currentUser.id,
  ).run();
  if (input.documentId) {
    await database.prepare(`UPDATE npd_documents SET linked_record_id=?,kind='inspection_record',
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(id, input.documentId).run();
  }
  await addActivity(database, input.projectId, currentUser.id, "提交质量检验", "inspection", id,
    `${itemName} 检验结果：${input.result}。`);
  await updateSpecialSheetProgress(database, input.projectId, "quality_inspection", currentUser.id);
  return { id };
}

export async function assignProjectMember(
  projectId: string,
  userId: string,
  responsibility: string,
  currentUser: NpdUser,
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
    "SELECT id FROM npd_project_members WHERE project_id=? AND user_id=?",
  ).bind(projectId, userId).first<{ id: string }>();
  if (existing) {
    await database.prepare(`UPDATE npd_project_members SET responsibility=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(responsibility.trim(), existing.id).run();
  } else {
    await database.prepare(`INSERT INTO npd_project_members
      (id,project_id,user_id,responsibility) VALUES (?,?,?,?)`).bind(
      makeId("member"), projectId, userId, responsibility.trim(),
    ).run();
  }
  await addActivity(database, projectId, currentUser.id, "调整项目成员", "member", userId,
    `${String(user.name)}：${responsibility.trim()}。`);
}

export async function setNpdProjectStatus(
  projectId: string,
  status: "active" | "paused" | "cancelled",
  reason: string,
  currentUser: NpdUser,
) {
  const { database, project } = await getEditableProject(projectId, currentUser);
  if (!isProjectSteward(currentUser, project)) {
    throw new Error("只有项目发起人、负责人或管理员可以变更项目状态。");
  }
  if (status !== "active" && !reason.trim()) throw new Error("暂停或终止项目必须填写原因。");
  await database.prepare(`UPDATE npd_projects SET status=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(status, projectId).run();
  await addActivity(database, projectId, currentUser.id, "变更项目状态", "project", projectId,
    `项目状态更新为 ${status === "active" ? "进行中" : status === "paused" ? "已暂停" : "已终止"}${reason.trim() ? `：${reason.trim()}` : ""}。`);
}

export interface CreateNpdUserInput {
  email: string;
  name: string;
  department: string;
  role: NpdRole;
  active: boolean;
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
  const duplicate = await database.prepare(
    "SELECT id FROM npd_users WHERE lower(email)=lower(?)",
  ).bind(email).first<{ id: string }>();
  if (duplicate) throw new Error("该登录邮箱已存在，请直接维护原账户。");
  const id = makeId("user");
  await database.prepare(`INSERT INTO npd_users
    (id,email,name,department,role,active,bootstrap_admin)
    VALUES (?,?,?,?,?,?,0)`).bind(
      id, email, name, department, input.role, input.active ? 1 : 0,
    ).run();
  await addActivity(database, null, currentUser.id, "新建登录账户", "user", id,
    `${name}（${email}）已创建为${roleLabels[input.role]}，账号${input.active ? "启用" : "停用"}。`);
  const created = await database.prepare("SELECT * FROM npd_users WHERE id=?")
    .bind(id).first<Row>();
  if (!created) throw new Error("账户创建失败。");
  return mapUser(created);
}

export async function updateNpdUser(
  input: { userId: string; email: string; name: string; role: NpdRole; department: string; active: boolean },
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  if (currentUser.role !== "admin") throw new Error("只有管理员可以维护人员权限。");
  const database = getDatabase();
  const target = await database.prepare("SELECT * FROM npd_users WHERE id=?")
    .bind(input.userId).first<Row>();
  if (!target) throw new Error("用户不存在。");
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  const department = input.department.trim();
  if (!name) throw new Error("请填写人员姓名。");
  if (!isValidAccountEmail(email)) throw new Error("请填写有效的登录邮箱。");
  if (!department) throw new Error("请填写所属部门。");
  if (!isNpdRole(input.role)) throw new Error("登录类型无效。");
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
  await database.prepare(`UPDATE npd_users SET email=?,name=?,role=?,department=?,active=?,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      email, name, input.role, department, input.active ? 1 : 0, input.userId,
    ).run();
  await addActivity(database, null, currentUser.id, "更新人员权限", "user", input.userId,
    `${name}（${email}）调整为${roleLabels[input.role]}，账号${input.active ? "启用" : "停用"}。`);
}

export async function saveDashboardPreference(
  preference: DashboardPreference,
  currentUser: NpdUser,
) {
  await ensureNpdDatabase();
  const modes = ["year", "half", "month", "custom"];
  if (!modes.includes(preference.periodMode) || !Array.isArray(preference.visibleMetrics)) {
    throw new Error("看板配置无效。");
  }
  const database = getDatabase();
  await database.prepare(`INSERT INTO npd_dashboard_preferences (user_id,payload)
    VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,
    updated_at=CURRENT_TIMESTAMP`).bind(currentUser.id, JSON.stringify(preference)).run();
  await addActivity(database, null, currentUser.id, "更新看板配置", "dashboard", currentUser.id,
    `统计周期调整为 ${preference.periodMode}，显示 ${preference.visibleMetrics.length} 项指标。`);
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
  if (input.motorId) {
    const motor = await database.prepare(
      "SELECT id FROM npd_project_motors WHERE id=? AND project_id=?",
    ).bind(input.motorId, input.projectId).first<Row>();
    if (!motor) throw new Error("附件关联的电机规格不存在。");
  }
  const id = makeId("document");
  await database.prepare(`INSERT INTO npd_documents (
    id,project_id,sheet_code,motor_id,linked_record_id,kind,file_name,object_key,
    content_type,size,version,uploaded_by
  ) VALUES (?,?,?,?,?,?,?,?,?,?, 'A1',?)`).bind(
    id, input.projectId, input.sheetCode, input.motorId, input.linkedRecordId,
    input.kind, input.fileName, input.objectKey, input.contentType, input.size,
    currentUser.id,
  ).run();
  await addActivity(database, input.projectId, currentUser.id, "上传附件", "document", id,
    `${input.fileName} 已上传至 ${sheetByCode[input.sheetCode].shortTitle}。`);
  return id;
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
  const snapshot = await getNpdWorkspaceSnapshot(currentUser);
  const project = snapshot.projects.find((row) => row.id === projectId);
  if (!project) throw new Error("项目不存在或无权访问。");
  return {
    project,
    customer: snapshot.customers.find((row) => row.id === project.customerId) || null,
    orders: snapshot.orders.filter((row) => row.projectId === projectId),
    members: snapshot.members.filter((row) => row.projectId === projectId),
    motors: snapshot.motors.filter((row) => row.projectId === projectId),
    sheets: snapshot.sheets.filter((row) => row.projectId === projectId),
    forms: snapshot.formRecords.filter((row) => row.projectId === projectId),
    parts: snapshot.parts.filter((row) => row.projectId === projectId),
    tests: snapshot.testReports.filter((row) => row.projectId === projectId),
    inspections: snapshot.inspections.filter((row) => row.projectId === projectId),
    documents: snapshot.documents.filter((row) => row.projectId === projectId),
    activities: snapshot.activities.filter((row) => row.projectId === projectId),
  };
}

async function getEditableProject(projectId: string, currentUser: NpdUser) {
  await ensureNpdDatabase();
  assertActive(currentUser);
  const database = getDatabase();
  const project = await assertProjectAccess(database, currentUser, projectId);
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
    const forms = await database.prepare(`SELECT form_code,status FROM npd_form_records
      WHERE project_id=? AND sheet_code=?`).bind(projectId, sheetCode).all<Row>();
    const missing = sheet.formCodes.filter((formCode) =>
      !forms.results.some((row) => row.form_code === formCode && row.status === "submitted"),
    );
    if (missing.length) {
      const names = missing.map((code) => formDefinitions.find((form) => form.code === code)?.name || code);
      throw new Error(`以下受控表单尚未提交：${names.join("、")}。`);
    }
  }

  if (sheetCode === "parts_plan") {
    const parts = await database.prepare(
      "SELECT status FROM npd_part_items WHERE project_id=?",
    ).bind(projectId).all<Row>();
    if (!parts.results.length) throw new Error("零部件明细为空，不能完成节点阶段。");
    if (parts.results.some((row) => row.status !== "completed")) {
      throw new Error("仍有零部件节点未由生产确认完成。");
    }
  }
  if (sheetCode === "verification") {
    const motors = await database.prepare("SELECT id,model FROM npd_project_motors WHERE project_id=?")
      .bind(projectId).all<Row>();
    const reports = await database.prepare("SELECT motor_id,result FROM npd_test_reports WHERE project_id=?")
      .bind(projectId).all<Row>();
    const missing = motors.results.filter((motor) =>
      !reports.results.some((report) => report.motor_id === motor.id),
    );
    if (missing.length) throw new Error(`以下规格尚无试验报告：${missing.map((row) => row.model).join("、")}。`);
    if (reports.results.some((report) => !["合格", "有条件合格"].includes(String(report.result)))) {
      throw new Error("存在不合格试验报告，验证阶段不能完成。");
    }
  }
  if (sheetCode === "quality_inspection") {
    const motors = await database.prepare("SELECT id,model FROM npd_project_motors WHERE project_id=?")
      .bind(projectId).all<Row>();
    const parts = await database.prepare(`SELECT id,part_no,name FROM npd_part_items
      WHERE project_id=? AND trim(inspection_requirement)!=''`).bind(projectId).all<Row>();
    const inspections = await database.prepare(`SELECT motor_id,part_item_id,result
      FROM npd_inspection_records WHERE project_id=?`).bind(projectId).all<Row>();
    const missingMotors = motors.results.filter((motor) =>
      !inspections.results.some((record) => record.motor_id === motor.id && !record.part_item_id),
    );
    const missingParts = parts.results.filter((part) =>
      !inspections.results.some((record) => record.part_item_id === part.id),
    );
    if (missingMotors.length || missingParts.length) {
      throw new Error(`质量记录未齐套：${[
        ...missingMotors.map((row) => row.model),
        ...missingParts.map((row) => `${row.part_no} ${row.name}`),
      ].join("、")}。`);
    }
    if (inspections.results.some((record) => !["合格", "让步接收"].includes(String(record.result)))) {
      throw new Error("存在不合格检验记录，质量阶段不能完成。");
    }
  }
}

async function updateSpecialSheetProgress(
  database: D1Database,
  projectId: string,
  sheetCode: "parts_plan" | "verification" | "quality_inspection",
  userId: string,
) {
  let completed = 0;
  let total = 0;
  if (sheetCode === "parts_plan") {
    const rows = await database.prepare("SELECT status FROM npd_part_items WHERE project_id=?")
      .bind(projectId).all<Row>();
    total = rows.results.length;
    completed = rows.results.filter((row) => row.status === "completed").length;
  } else if (sheetCode === "verification") {
    const motors = await database.prepare("SELECT id FROM npd_project_motors WHERE project_id=?")
      .bind(projectId).all<Row>();
    const reports = await database.prepare("SELECT DISTINCT motor_id FROM npd_test_reports WHERE project_id=?")
      .bind(projectId).all<Row>();
    total = motors.results.length;
    completed = reports.results.length;
  } else {
    const motors = await database.prepare("SELECT id FROM npd_project_motors WHERE project_id=?")
      .bind(projectId).all<Row>();
    const parts = await database.prepare(`SELECT id FROM npd_part_items
      WHERE project_id=? AND trim(inspection_requirement)!=''`).bind(projectId).all<Row>();
    total = motors.results.length + parts.results.length;
    const records = await database.prepare(`SELECT DISTINCT motor_id,part_item_id
      FROM npd_inspection_records WHERE project_id=?`).bind(projectId).all<Row>();
    completed = records.results.length;
  }
  const progress = total ? Math.min(90, Math.round((completed / total) * 90)) : 0;
  await database.prepare(`UPDATE npd_project_sheets SET status='in_progress',progress=?,
    updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND code=?`).bind(
    progress, userId, projectId, sheetCode,
  ).run();
  await recalculateProject(database, projectId);
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
  await database.prepare(`UPDATE npd_projects SET progress=?,current_sheet_code=?,status=?,
    actual_end=CASE WHEN ?='completed' THEN COALESCE(actual_end,?) ELSE actual_end END,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(
      completed ? 100 : progress, String(current?.code || "change_archive"), status,
      status, currentDateIso(), projectId,
    ).run();
}

async function assertDocumentLink(
  database: D1Database,
  documentId: string | null,
  projectId: string,
  sheetCode: SheetCode,
) {
  if (!documentId) return;
  const row = await database.prepare(
    "SELECT id FROM npd_documents WHERE id=? AND project_id=? AND sheet_code=?",
  ).bind(documentId, projectId, sheetCode).first<Row>();
  if (!row) throw new Error("附件不存在或不属于当前项目阶段。");
}

async function nextProjectCode(database: D1Database) {
  const year = new Date().getFullYear();
  const row = await database.prepare(
    "SELECT code FROM npd_projects WHERE code LIKE ? ORDER BY code DESC LIMIT 1",
  ).bind(`NP-${year}-%`).first<{ code: string }>();
  const next = row?.code ? Number(row.code.split("-").at(-1) || 0) + 1 : 1;
  return `NP-${year}-${String(next).padStart(3, "0")}`;
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
  return ["admin", "sales", "design", "production", "tester", "quality"].includes(role)
    ? role as NpdRole
    : "sales";
}

function isNpdRole(value: unknown): value is NpdRole {
  return ["admin", "sales", "design", "production", "tester", "quality"].includes(String(value));
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isValidAccountEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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

function dateDiffDays(start: string, end: string) {
  return Math.max(0, Math.floor(
    (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
      86400000,
  ));
}

function interpolateDate(start: string, end: string, ratio: number) {
  const startMs = new Date(`${start}T00:00:00Z`).getTime();
  const endMs = new Date(`${end}T00:00:00Z`).getTime();
  return new Date(startMs + (endMs - startMs) * ratio).toISOString().slice(0, 10);
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
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
