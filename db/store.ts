import { env } from "cloudflare:workers";
import type {
  Activity,
  Approval,
  ChangeRequest,
  CurrentUser,
  Customer,
  DocumentRecord,
  FormRecord,
  GateStatus,
  Issue,
  Milestone,
  Project,
  RiskLevel,
  RoleKey,
  SalesOrder,
  UserRecord,
  WorkspaceSnapshot,
} from "../lib/domain";
import { formDefinitions } from "../lib/forms";
import { roleLabels } from "../lib/permissions";

type Row = Record<string, string | number | null>;
type RuntimeEnv = { DB?: D1Database; FILES?: R2Bucket };

const stageLabels: Record<string, string> = {
  initiation: "立项决策",
  planning: "设计策划",
  input_review: "输入评审",
  design_output: "设计输出",
  design_review: "输出评审",
  verification: "样机验证",
  confirmation: "设计确认",
  release: "定型下发",
  change: "变更归档",
};

const gateBlueprint = [
  ["initiation", "立项决策", "技术部 / 销售部", "HD/JL-SJ-01A1"],
  ["planning", "设计策划", "项目负责人", "HD/JL-SJ-02A1"],
  ["input_review", "输入评审", "技术部", "HD/JL-SJ-04A1"],
  ["design_output", "设计输出", "设计科 / 工艺科", "HD/JL-SJ-10A1"],
  ["design_review", "输出评审", "跨部门评审组", "HD/JL-SJ-05A1"],
  ["verification", "样机验证", "质量部 / 制造部", "HD/JL-SJ-06A1"],
  ["confirmation", "设计确认", "销售部 / 技术部", "HD/JL-SJ-07A1"],
  ["release", "定型下发", "技术部", "HD/JL-SJ-08A1"],
  ["change", "变更归档", "技术部 / 相关部门", "HD/JL-SJ-09A1"],
] as const;

// 初始排期按程序文件的“设计 : 工艺 : 制造 = 2 : 1 : 7”分配，
// 再把评审、确认和定型节点嵌入对应阶段。项目负责人可在系统中逐项调整。
const gateScheduleRatios = [0.04, 0.1, 0.16, 0.2, 0.3, 0.72, 0.88, 1, 1];

let initializationPromise: Promise<void> | null = null;

export function getRuntimeEnv() {
  return env as unknown as RuntimeEnv;
}

function getDatabase() {
  const database = getRuntimeEnv().DB;
  if (!database) {
    throw new Error("D1 数据库未绑定，请将 .openai/hosting.json 的 d1 设置为 DB。");
  }
  return database;
}

export async function ensureDatabase() {
  if (!initializationPromise) {
    initializationPromise = initializeDatabase().catch((error) => {
      initializationPromise = null;
      throw error;
    });
  }
  await initializationPromise;
}

async function initializeDatabase() {
  const database = getDatabase();
  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      department TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      current_load INTEGER NOT NULL DEFAULT 0, bootstrap_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      industry TEXT NOT NULL, contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      tier TEXT NOT NULL DEFAULT 'B', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sales_orders (
      id TEXT PRIMARY KEY, order_no TEXT NOT NULL UNIQUE,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      product_model TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
      amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'CNY',
      delivery_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      product_model TEXT NOT NULL, motor_code TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL, source TEXT NOT NULL,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      order_id TEXT REFERENCES sales_orders(id),
      owner_id TEXT NOT NULL REFERENCES users(id),
      tracker_name TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'initiation', status TEXT NOT NULL DEFAULT 'planning',
      progress INTEGER NOT NULL DEFAULT 0, risk_level TEXT NOT NULL DEFAULT 'low',
      planned_start TEXT NOT NULL, planned_end TEXT NOT NULL, actual_end TEXT,
      budget REAL NOT NULL DEFAULT 0, spent REAL NOT NULL DEFAULT 0,
      target_cost REAL NOT NULL DEFAULT 0, priority TEXT NOT NULL DEFAULT 'normal',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      responsibility TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      gate_code TEXT NOT NULL,
      name TEXT NOT NULL, department TEXT NOT NULL, owner_name TEXT NOT NULL,
      planned_date TEXT NOT NULL, actual_date TEXT, status TEXT NOT NULL DEFAULT 'not_started',
      progress INTEGER NOT NULL DEFAULT 0, required_form TEXT NOT NULL DEFAULT '',
      evidence_count INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL, form_code TEXT NOT NULL, form_name TEXT NOT NULL,
      submitter_id TEXT NOT NULL REFERENCES users(id),
      approver_role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      submitted_at TEXT NOT NULL, due_at TEXT NOT NULL, decision_at TEXT,
      decision_by TEXT REFERENCES users(id), comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'open', due_date TEXT NOT NULL,
      resolution TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS change_requests (
      id TEXT PRIMARY KEY, change_no TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL REFERENCES projects(id),
      change_type TEXT NOT NULL, title TEXT NOT NULL, reason TEXT NOT NULL,
      initiator_id TEXT NOT NULL REFERENCES users(id),
      affected_object TEXT NOT NULL,
      supplier_notice INTEGER NOT NULL DEFAULT 0, customer_notice INTEGER NOT NULL DEFAULT 0,
      disposition TEXT NOT NULL DEFAULT '待评估', status TEXT NOT NULL DEFAULT 'draft',
      due_date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS form_records (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      form_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
      payload TEXT NOT NULL DEFAULT '{}', updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      form_code TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL, object_key TEXT NOT NULL, content_type TEXT NOT NULL,
      size INTEGER NOT NULL, version TEXT NOT NULL DEFAULT 'A1',
      uploaded_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id),
      actor_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL, detail TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    "CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status)",
    "CREATE INDEX IF NOT EXISTS milestones_project_idx ON milestones(project_id, sort_order)",
    "CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals(status, due_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_unique ON project_members(project_id, user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS form_records_project_form_unique ON form_records(project_id, form_code)",
    "CREATE INDEX IF NOT EXISTS form_records_project_idx ON form_records(project_id, form_code)",
    "CREATE INDEX IF NOT EXISTS documents_project_idx ON documents(project_id)",
  ];

  await database.batch(
    schemaStatements.map((statement) => database.prepare(statement)),
  );

  const existing = await database
    .prepare("SELECT COUNT(*) AS count FROM projects")
    .first<{ count: number }>();
  if (!existing?.count) {
    await seedDatabase(database);
  }
}

async function seedDatabase(database: D1Database) {
  const userRows = [
    ["u-admin", "admin@hengda-motor.local", "谢鹏程", "信息化办公室", "system_admin", 2],
    ["u-tech-director", "tech.director@hengda-motor.local", "陈建国", "技术部", "technical_director", 4],
    ["u-pm-1", "wang.lin@hengda-motor.local", "王琳", "技术部·设计科", "project_manager", 5],
    ["u-pm-2", "liu.yang@hengda-motor.local", "刘洋", "技术部·设计科", "project_manager", 4],
    ["u-design", "zhou.ning@hengda-motor.local", "周宁", "技术部·设计科", "designer", 6],
    ["u-process", "sun.wei@hengda-motor.local", "孙伟", "技术部·工艺科", "process", 5],
    ["u-quality", "zhao.min@hengda-motor.local", "赵敏", "质量部", "quality", 4],
    ["u-mfg", "wu.jun@hengda-motor.local", "吴军", "制造部", "manufacturing", 5],
    ["u-procure", "gao.yan@hengda-motor.local", "高燕", "采购部", "procurement", 3],
    ["u-sales", "xu.jie@hengda-motor.local", "徐杰", "销售部", "sales", 4],
    ["u-finance", "he.qin@hengda-motor.local", "何琴", "财务部", "finance", 2],
    ["u-manager", "gm@hengda-motor.local", "王明兴", "总经理办公室", "management", 2],
  ];

  const customerRows = [
    ["c-001", "KH-0186", "江苏海川泵业有限公司", "工业泵", "李晨", "138****6812", "A"],
    ["c-002", "KH-0112", "青岛港机装备集团", "港口起重", "赵海", "186****0933", "A"],
    ["c-003", "KH-0241", "苏州热工装备有限公司", "工业炉风机", "沈工", "139****7218", "B"],
    ["c-004", "KH-0088", "越南 Mekong Pump JSC", "水泵与出口设备", "Nguyen An", "+84 *** 827", "A"],
    ["c-005", "KH-0268", "宁波精工传动科技", "通用机械", "郑磊", "137****3169", "B"],
  ];

  const orderRows = [
    ["o-001", "SO-260719", "c-001", "HE3-160M-4", 36, 1248000, "CNY", "2026-09-15", "confirmed"],
    ["o-002", "SO-260731", "c-002", "YVF2-280S-6", 18, 1886000, "CNY", "2026-10-20", "confirmed"],
    ["o-003", "SO-260615", "c-004", "YE3-132S-2", 60, 1020000, "CNY", "2026-08-28", "in_production"],
    ["o-004", "SO-260806", "c-003", "YKK-355M-4", 8, 1360000, "CNY", "2026-11-18", "technical_review"],
    ["o-005", "SO-260412", "c-005", "YE4-112M-4", 120, 1080000, "CNY", "2026-07-30", "completed"],
  ];

  const projectRows = [
    ["p-018", "NP-2026-018", "IE5 超高效异步电机开发", "HE3-160M-4", "HD26-1604", "全新产品", "客户", "c-001", "o-001", "u-pm-1", "周宁", "verification", "active", 72, "medium", "2026-05-12", "2026-08-18", null, 680000, 452000, 2650, "high", "面向高能效泵组的 IE5 电机平台，重点优化电磁方案、温升与成本。"],
    ["p-021", "NP-2026-021", "港机变频制动电机", "YVF2-280S-6", "HD26-2806", "全新产品", "客户", "c-002", "o-002", "u-pm-2", "孙伟", "design_review", "active", 46, "high", "2026-06-08", "2026-09-05", null, 920000, 338000, 18500, "urgent", "港口起重工况，要求低速高转矩、频繁制动和盐雾环境适应性。"],
    ["p-015", "NP-2026-015", "东南亚泵用电机系列化", "YE3-132S-2", "HD26-1322", "派生产品", "客户", "c-004", "o-003", "u-pm-1", "赵敏", "confirmation", "active", 88, "low", "2026-04-18", "2026-07-30", null, 420000, 389000, 1480, "normal", "满足 50Hz/60Hz 双频出口需求并完成客户现场连续运行确认。"],
    ["p-023", "NP-2026-023", "高温炉循环风机电机", "YKK-355M-4", "HD26-3554", "全新产品", "行业要求", "c-003", "o-004", "u-pm-2", "王琳", "planning", "active", 18, "medium", "2026-07-15", "2026-10-28", null, 1180000, 126000, 0, "high", "高环境温度和粉尘工况，需完成绝缘、轴承冷却与防护结构专项论证。"],
    ["p-012", "NP-2026-012", "高效率通用电机降本迭代", "YE4-112M-4", "HD26-1124", "改进产品", "企业研发", "c-005", "o-005", "u-pm-1", "孙伟", "release", "completed", 100, "low", "2026-02-09", "2026-06-26", "2026-06-24", 360000, 341000, 920, "normal", "完成材料替代与通用化设计，效率保持不变，单台成本下降 7.8%。"],
  ];

  const statements: D1PreparedStatement[] = [];
  for (const row of userRows) {
    statements.push(
      database
        .prepare("INSERT INTO users (id,email,name,department,role,current_load) VALUES (?,?,?,?,?,?)")
        .bind(...row),
    );
  }
  for (const row of customerRows) {
    statements.push(
      database
        .prepare("INSERT INTO customers (id,code,name,industry,contact,phone,tier) VALUES (?,?,?,?,?,?,?)")
        .bind(...row),
    );
  }
  for (const row of orderRows) {
    statements.push(
      database
        .prepare("INSERT INTO sales_orders (id,order_no,customer_id,product_model,quantity,amount,currency,delivery_date,status) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(...row),
    );
  }
  for (const row of projectRows) {
    statements.push(
      database
        .prepare(`INSERT INTO projects (
          id,code,name,product_model,motor_code,category,source,customer_id,order_id,
          owner_id,tracker_name,stage,status,progress,risk_level,planned_start,planned_end,
          actual_end,budget,spent,target_cost,priority,description
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(...row),
    );
  }
  await database.batch(statements);

  await seedMilestones(database, projectRows);
  await seedOperationalData(database);
}

async function seedMilestones(database: D1Database, projectRows: unknown[][]) {
  const owners = ["王琳", "刘洋", "周宁", "孙伟", "赵敏", "徐杰", "陈建国"];
  const stageIndex: Record<string, number> = {
    initiation: 0,
    planning: 1,
    input_review: 2,
    design_output: 3,
    design_review: 4,
    verification: 5,
    confirmation: 6,
    release: 7,
    change: 8,
  };

  const statements: D1PreparedStatement[] = [];
  for (const project of projectRows) {
    const projectId = String(project[0]);
    const stage = String(project[11]);
    const startDate = String(project[15]);
    const endDate = String(project[16]);
    const currentIndex = stageIndex[stage] ?? 0;

    gateBlueprint.forEach((gate, index) => {
      const plannedDate = plannedGateDate(startDate, endDate, index);
      const planned = new Date(`${plannedDate}T00:00:00Z`);
      const status: GateStatus =
        index < currentIndex
          ? "completed"
          : index === currentIndex
            ? stage === "release" && project[12] === "completed"
              ? "completed"
              : "in_progress"
            : "not_started";
      const actualDate =
        status === "completed"
          ? new Date(planned.getTime() - 86400000).toISOString().slice(0, 10)
          : null;
      const note =
        projectId === "p-021" && gate[0] === "design_review"
          ? "制动器供应商热容量数据未确认，评审暂有条件通过。"
          : projectId === "p-018" && gate[0] === "verification"
            ? "温升试验完成，等待第三方效率复测报告。"
            : "";

      statements.push(
        database
          .prepare(`INSERT INTO milestones (
            id,project_id,gate_code,name,department,owner_name,planned_date,actual_date,
            status,progress,required_form,evidence_count,note,sort_order
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(
            `ms-${projectId}-${index + 1}`,
            projectId,
            gate[0],
            gate[1],
            gate[2],
            owners[index % owners.length],
            plannedDate,
            actualDate,
            status,
            status === "completed" ? 100 : status === "in_progress" ? 55 : 0,
            gate[3],
            status === "completed" ? 2 + (index % 3) : status === "in_progress" ? 1 : 0,
            note,
            index + 1,
          ),
      );
    });
  }
  await database.batch(statements);
}

async function seedOperationalData(database: D1Database) {
  const statements = [
    database.prepare("INSERT INTO approvals (id,project_id,title,form_code,form_name,submitter_id,approver_role,status,submitted_at,due_at,comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind("ap-001", "p-018", "IE5 样机验证报告审批", "HD/JL-SJ-06A1", "设计开发验证报告", "u-quality", "technical_director", "pending", "2026-07-22 09:20", "2026-07-24", "效率复测报告补充后可批准。"),
    database.prepare("INSERT INTO approvals (id,project_id,title,form_code,form_name,submitter_id,approver_role,status,submitted_at,due_at,comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind("ap-002", "p-021", "输出评审结论审批", "HD/JL-SJ-05A1", "设计开发评审表", "u-pm-2", "technical_director", "pending", "2026-07-21 16:05", "2026-07-23", "有 2 项整改待确认。"),
    database.prepare("INSERT INTO approvals (id,project_id,title,form_code,form_name,submitter_id,approver_role,status,submitted_at,due_at,comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind("ap-003", "p-023", "高温风机电机立项审批", "HD/JL-SJ-01A1", "新产品开发立项申请表", "u-sales", "management", "pending", "2026-07-22 14:30", "2026-07-25", "订单技术附件已齐套。"),
    database.prepare("INSERT INTO approvals (id,project_id,title,form_code,form_name,submitter_id,approver_role,status,submitted_at,due_at,decision_at,decision_by,comment) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind("ap-004", "p-015", "客户试用确认归档", "HD/JL-SJ-07A1", "客户试用报告", "u-sales", "technical_director", "approved", "2026-07-18 10:00", "2026-07-20", "2026-07-19 15:16", "u-tech-director", "客户连续运行 120 小时无异常。"),
    database.prepare("INSERT INTO issues (id,project_id,title,category,severity,owner_id,status,due_date,resolution) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind("is-001", "p-021", "制动器热容量数据未获供应商确认", "供应链", "high", "u-procure", "open", "2026-07-24", ""),
    database.prepare("INSERT INTO issues (id,project_id,title,category,severity,owner_id,status,due_date,resolution) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind("is-002", "p-018", "IE5 效率第三方复测排期延后", "验证", "medium", "u-quality", "open", "2026-07-26", ""),
    database.prepare("INSERT INTO issues (id,project_id,title,category,severity,owner_id,status,due_date,resolution) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind("is-003", "p-023", "高温绝缘体系选型缺少寿命数据", "技术", "medium", "u-design", "open", "2026-07-29", ""),
    database.prepare("INSERT INTO issues (id,project_id,title,category,severity,owner_id,status,due_date,resolution) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind("is-004", "p-015", "客户现场电源波动导致启停记录异常", "客户现场", "low", "u-sales", "closed", "2026-07-17", "补测后确认电机本体无异常。"),
    database.prepare("INSERT INTO change_requests (id,change_no,project_id,change_type,title,reason,initiator_id,affected_object,supplier_notice,customer_notice,disposition,status,due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind("cr-001", "ECN-2026-047", "p-018", "更改图纸", "风扇结构减重与噪声优化", "样机噪声较目标值高 1.8dB(A)", "u-design", "风扇图 HD-F160-04 / CAXA", 1, 0, "旧件用完止", "under_review", "2026-07-27"),
    database.prepare("INSERT INTO change_requests (id,change_no,project_id,change_type,title,reason,initiator_id,affected_object,supplier_notice,customer_notice,disposition,status,due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind("cr-002", "ECN-2026-043", "p-015", "临时更改", "出口铭牌增加双频参数", "客户清关与现场验收要求", "u-sales", "铭牌图 / 说明书", 1, 1, "返修", "approved", "2026-07-21"),
    database.prepare("INSERT INTO change_requests (id,change_no,project_id,change_type,title,reason,initiator_id,affected_object,supplier_notice,customer_notice,disposition,status,due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind("cr-003", "ECN-2026-051", "p-021", "更改CAXA", "接线盒安装方向调整", "港机布置干涉，客户提出接口变更", "u-pm-2", "总装图 YVF2-280-00", 0, 1, "待评估", "draft", "2026-07-30"),
    database.prepare("INSERT INTO form_records (id,project_id,form_code,status,version,payload,updated_by) VALUES (?,?,?,?,?,?,?)")
      .bind("fr-001", "p-018", "HD/JL-SJ-01A1", "approved", 2, JSON.stringify({ productName: "IE5 超高效异步电机开发", productModel: "HE3-160M-4", source: "客户", targetUnitCost: 2650 }), "王琳"),
    database.prepare("INSERT INTO form_records (id,project_id,form_code,status,version,payload,updated_by) VALUES (?,?,?,?,?,?,?)")
      .bind("fr-002", "p-018", "HD/JL-SJ-05A1", "approved", 3, JSON.stringify({ developmentStage: "输出评审", conclusion: "有条件通过", issues: "效率复测报告待补充。" }), "陈建国"),
    database.prepare("INSERT INTO form_records (id,project_id,form_code,status,version,payload,updated_by) VALUES (?,?,?,?,?,?,?)")
      .bind("fr-003", "p-018", "HD/JL-SJ-06A1", "submitted", 1, JSON.stringify({ sampleNo: "S26-018-01", testRange: "2026-07-15 至 2026-07-20", conclusion: "有条件通过" }), "赵敏"),
    database.prepare("INSERT INTO form_records (id,project_id,form_code,status,version,payload,updated_by) VALUES (?,?,?,?,?,?,?)")
      .bind("fr-004", "p-015", "HD/JL-SJ-07A1", "approved", 1, JSON.stringify({ customerName: "越南 Mekong Pump JSC", sampleQuantity: 2, conclusion: "连续运行稳定，同意定型。" }), "徐杰"),
    database.prepare("INSERT INTO form_records (id,project_id,form_code,status,version,payload,updated_by) VALUES (?,?,?,?,?,?,?)")
      .bind("fr-005", "p-021", "HD/JL-SJ-05A1", "submitted", 2, JSON.stringify({ developmentStage: "输出评审", conclusion: "有条件通过", issues: "制动器热容量数据待供应商确认。" }), "刘洋"),
    database.prepare("INSERT INTO activities (id,project_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind("ac-001", "p-018", "u-quality", "提交审批", "设计开发验证报告 V1 已提交技术总监审批", "2026-07-22 09:20"),
    database.prepare("INSERT INTO activities (id,project_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind("ac-002", "p-021", "u-pm-2", "更新进度", "输出评审完成度更新至 55%，新增 1 项供应链风险", "2026-07-21 16:05"),
    database.prepare("INSERT INTO activities (id,project_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind("ac-003", "p-015", "u-sales", "客户确认", "客户试用报告已签署并完成归档", "2026-07-19 14:52"),
    database.prepare("INSERT INTO activities (id,project_id,actor_id,action,detail,created_at) VALUES (?,?,?,?,?,?)")
      .bind("ac-004", "p-018", "u-design", "发起变更", "ECN-2026-047 风扇结构优化已进入评审", "2026-07-20 11:35"),
  ];
  await database.batch(statements);
}

export async function resolveCurrentUser(
  authenticatedEmail: string | null,
  authenticatedName: string | null,
): Promise<CurrentUser> {
  await ensureDatabase();
  const database = getDatabase();

  if (!authenticatedEmail) {
    if (process.env.NODE_ENV === "development") {
      const demo = await database
        .prepare("SELECT * FROM users WHERE id = 'u-admin'")
        .first<Row>();
      return mapCurrentUser(demo!);
    }
    return {
      id: "anonymous",
      name: "访客",
      email: "",
      department: "外部访问",
      role: "viewer",
      roleLabel: roleLabels.viewer,
      avatar: "访",
    };
  }

  let user = await database
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(authenticatedEmail)
    .first<Row>();

  if (!user) {
    const claimed = await database
      .prepare("SELECT COUNT(*) AS count FROM users WHERE bootstrap_admin = 1")
      .first<{ count: number }>();
    const role: RoleKey = claimed?.count ? "viewer" : "system_admin";
    const id = makeId("u");
    await database
      .prepare("INSERT INTO users (id,email,name,department,role,current_load,bootstrap_admin) VALUES (?,?,?,?,?,?,?)")
      .bind(
        id,
        authenticatedEmail,
        authenticatedName || authenticatedEmail.split("@")[0],
        role === "system_admin" ? "系统管理" : "待分配",
        role,
        0,
        role === "system_admin" ? 1 : 0,
      )
      .run();
    user = await database
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(id)
      .first<Row>();
  }

  const current = mapCurrentUser(user!);
  return Boolean(user!.active)
    ? current
    : { ...current, role: "viewer", roleLabel: "账号已停用" };
}

function mapCurrentUser(row: Row): CurrentUser {
  const role = String(row.role) as RoleKey;
  const name = String(row.name);
  return {
    id: String(row.id),
    name,
    email: String(row.email),
    department: String(row.department),
    role,
    roleLabel: roleLabels[role],
    avatar: name.slice(-2),
  };
}

export async function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  await ensureDatabase();
  const database = getDatabase();

  const [
    projectResult,
    customerResult,
    orderResult,
    milestoneResult,
    approvalResult,
    issueResult,
    changeResult,
    activityResult,
    userResult,
    documentResult,
    formResult,
  ] = await Promise.all([
    database.prepare(`SELECT p.*, c.name AS customer_name, o.order_no, u.name AS owner_name
      FROM projects p
      LEFT JOIN customers c ON c.id = p.customer_id
      LEFT JOIN sales_orders o ON o.id = p.order_id
      LEFT JOIN users u ON u.id = p.owner_id
      ORDER BY CASE p.risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      p.planned_end ASC`).all<Row>(),
    database.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM projects p WHERE p.customer_id = c.id AND p.status = 'active') AS active_projects
      FROM customers c ORDER BY c.tier, c.name`).all<Row>(),
    database.prepare(`SELECT o.*, c.name AS customer_name, p.id AS project_id,
      p.code AS project_code, p.name AS project_name
      FROM sales_orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN projects p ON p.order_id = o.id
      ORDER BY o.delivery_date ASC`).all<Row>(),
    database.prepare("SELECT * FROM milestones ORDER BY project_id, sort_order").all<Row>(),
    database.prepare(`SELECT a.*, p.code AS project_code, p.name AS project_name,
      u.name AS submitter_name
      FROM approvals a
      JOIN projects p ON p.id = a.project_id
      LEFT JOIN users u ON u.id = a.submitter_id
      ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.due_at ASC`).all<Row>(),
    database.prepare(`SELECT i.*, p.code AS project_code, p.name AS project_name,
      u.name AS owner_name
      FROM issues i JOIN projects p ON p.id = i.project_id
      LEFT JOIN users u ON u.id = i.owner_id
      ORDER BY CASE i.status WHEN 'open' THEN 0 ELSE 1 END,
      CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`).all<Row>(),
    database.prepare(`SELECT c.*, p.code AS project_code, p.name AS project_name,
      u.name AS initiator_name
      FROM change_requests c JOIN projects p ON p.id = c.project_id
      LEFT JOIN users u ON u.id = c.initiator_id
      ORDER BY c.created_at DESC`).all<Row>(),
    database.prepare(`SELECT a.*, p.code AS project_code, u.name AS actor_name
      FROM activities a
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC LIMIT 12`).all<Row>(),
    database.prepare("SELECT * FROM users ORDER BY active DESC, department, name").all<Row>(),
    database.prepare("SELECT * FROM documents ORDER BY created_at DESC").all<Row>(),
    database.prepare("SELECT * FROM form_records ORDER BY updated_at DESC").all<Row>(),
  ]);

  const milestones = milestoneResult.results.map(mapMilestone);
  const issues = issueResult.results.map(mapIssue);
  const forms = formResult.results.map(mapFormRecord);
  const issueCount = new Map<string, number>();
  for (const issue of issues) {
    if (issue.status !== "closed") {
      issueCount.set(issue.projectId, (issueCount.get(issue.projectId) || 0) + 1);
    }
  }

  const projects = projectResult.results.map((row) =>
    mapProject(
      row,
      milestones.filter((milestone) => milestone.projectId === row.id),
      forms.filter((record) => record.projectId === row.id),
      issueCount.get(String(row.id)) || 0,
    ),
  );
  const orders = orderResult.results.map(mapOrder);
  const activeProjects = projects.filter(
    (project) => project.status === "active" || project.status === "planning",
  );
  const activeOrders = orders.filter((order) => order.status !== "completed");
  const completedMilestones = milestones.filter((milestone) => milestone.status === "completed");
  const completedOnTime = completedMilestones.filter(
    (milestone) =>
      milestone.actualDate && milestone.actualDate <= milestone.plannedDate,
  );
  const today = currentDateIso();
  const completedProjectCycleDays = projects
    .filter((project) => project.status === "completed" && project.actualEnd)
    .map((project) =>
      Math.max(
        1,
        Math.round(
          (new Date(`${project.actualEnd}T00:00:00Z`).getTime() -
            new Date(`${project.plannedStart}T00:00:00Z`).getTime()) /
            86400000,
        ),
      ),
    );

  return {
    projects,
    customers: customerResult.results.map(mapCustomer),
    orders,
    milestones,
    approvals: approvalResult.results.map(mapApproval),
    issues,
    changes: changeResult.results.map(mapChange),
    activities: activityResult.results.map(mapActivity),
    users: userResult.results.map(mapUser),
    documents: documentResult.results.map(mapDocument),
    formRecords: forms,
    metrics: {
      activeProjects: activeProjects.length,
      onTimeRate: completedMilestones.length
        ? Math.round((completedOnTime.length / completedMilestones.length) * 100)
        : 100,
      overdueMilestones: milestones.filter(
        (milestone) =>
          milestone.status !== "completed" && milestone.plannedDate < today,
      ).length,
      pendingApprovals: approvalResult.results.filter((row) => row.status === "pending").length,
      highRiskProjects: activeProjects.filter(
        (project) =>
          project.riskLevel === "high" || project.riskLevel === "critical",
      ).length,
      orderCoverage: activeOrders.length
        ? Math.round(
            (activeOrders.filter((order) => order.projectId).length /
              activeOrders.length) *
              100,
          )
        : 100,
      completedThisQuarter: projects.filter(
        (project) =>
          project.status === "completed" &&
          project.actualEnd &&
          project.actualEnd >= "2026-07-01",
      ).length,
      averageCycleDays: completedProjectCycleDays.length
        ? Math.round(
            completedProjectCycleDays.reduce((sum, days) => sum + days, 0) /
              completedProjectCycleDays.length,
          )
        : 0,
    },
  };
}

function mapProject(
  row: Row,
  projectMilestones: Milestone[],
  projectForms: FormRecord[],
  openIssueCount: number,
): Project {
  const lifecycleMilestones = projectMilestones.filter(
    (milestone) => milestone.gateCode !== "change",
  );
  const next =
    row.status === "completed"
      ? undefined
      : lifecycleMilestones.find(
          (milestone) =>
            milestone.status !== "completed" && milestone.status !== "waived",
        ) || lifecycleMilestones.at(-1);
  const today = new Date(`${currentDateIso()}T00:00:00Z`);
  const nextDate = next ? new Date(`${next.plannedDate}T00:00:00Z`) : today;
  const overdueDays =
    next && next.status !== "completed" && nextDate < today
      ? Math.ceil((today.getTime() - nextDate.getTime()) / 86400000)
      : 0;
  const requiredCodes = new Set(
    lifecycleMilestones.flatMap((milestone) =>
      requiredFormsForGate(milestone.gateCode, String(row.category)),
    ),
  );
  const satisfiedCodes = new Set(
    projectForms
      .filter(
        (record) =>
          requiredCodes.has(record.formCode) &&
          (record.status === "approved" || record.status === "submitted"),
      )
      .map((record) => record.formCode),
  );
  for (const milestone of lifecycleMilestones) {
    if (milestone.status === "waived") {
      for (const formCode of requiredFormsForGate(
        milestone.gateCode,
        String(row.category),
      )) {
        satisfiedCodes.add(formCode);
      }
    }
  }

  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    productModel: String(row.product_model),
    motorCode: String(row.motor_code),
    category: String(row.category),
    source: String(row.source),
    customerId: String(row.customer_id),
    customerName: String(row.customer_name || "内部研发"),
    orderId: row.order_id ? String(row.order_id) : null,
    orderNo: row.order_no ? String(row.order_no) : null,
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name || "未分配"),
    trackerName: String(row.tracker_name),
    stage: String(row.stage),
    stageLabel: stageLabels[String(row.stage)] || String(row.stage),
    status: String(row.status) as Project["status"],
    progress: Number(row.progress),
    riskLevel: String(row.risk_level) as RiskLevel,
    plannedStart: String(row.planned_start),
    plannedEnd: String(row.planned_end),
    actualEnd: row.actual_end ? String(row.actual_end) : null,
    budget: Number(row.budget),
    spent: Number(row.spent),
    targetCost: Number(row.target_cost),
    priority: String(row.priority),
    description: String(row.description),
    nextMilestone: next?.name || "已完成",
    nextMilestoneDate: next?.plannedDate || String(row.actual_end || row.planned_end),
    overdueDays,
    formCompletion: Math.min(
      100,
      Math.round(
        (satisfiedCodes.size / Math.max(1, requiredCodes.size)) *
          100,
      ),
    ),
    issueCount: openIssueCount,
  };
}

function mapMilestone(row: Row): Milestone {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    gateCode: String(row.gate_code),
    name: String(row.name),
    department: String(row.department),
    ownerName: String(row.owner_name),
    plannedDate: String(row.planned_date),
    actualDate: row.actual_date ? String(row.actual_date) : null,
    status: String(row.status) as GateStatus,
    progress: Number(row.progress),
    requiredForm: String(row.required_form),
    evidenceCount: Number(row.evidence_count),
    note: String(row.note),
  };
}

function mapApproval(row: Row): Approval {
  const approverRole = String(row.approver_role) as RoleKey;
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectCode: String(row.project_code),
    projectName: String(row.project_name),
    title: String(row.title),
    formCode: String(row.form_code),
    formName: String(row.form_name),
    submitterName: String(row.submitter_name || "未知"),
    approverRole,
    approverLabel: roleLabels[approverRole],
    status: String(row.status) as Approval["status"],
    submittedAt: String(row.submitted_at),
    dueAt: String(row.due_at),
    decisionAt: row.decision_at ? String(row.decision_at) : null,
    comment: String(row.comment || ""),
  };
}

function mapIssue(row: Row): Issue {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    projectCode: String(row.project_code),
    projectName: String(row.project_name),
    title: String(row.title),
    category: String(row.category),
    severity: String(row.severity) as RiskLevel,
    ownerName: String(row.owner_name || "未分配"),
    status: String(row.status),
    dueDate: String(row.due_date),
    createdAt: String(row.created_at),
    resolution: String(row.resolution || ""),
  };
}

function mapChange(row: Row): ChangeRequest {
  return {
    id: String(row.id),
    changeNo: String(row.change_no),
    projectId: String(row.project_id),
    projectCode: String(row.project_code),
    projectName: String(row.project_name),
    changeType: String(row.change_type),
    title: String(row.title),
    reason: String(row.reason),
    initiatorName: String(row.initiator_name || "未知"),
    affectedObject: String(row.affected_object),
    supplierNotice: Boolean(row.supplier_notice),
    customerNotice: Boolean(row.customer_notice),
    disposition: String(row.disposition),
    status: String(row.status),
    createdAt: String(row.created_at),
    dueDate: String(row.due_date),
  };
}

function mapActivity(row: Row): Activity {
  return {
    id: String(row.id),
    projectId: row.project_id ? String(row.project_id) : null,
    projectCode: row.project_code ? String(row.project_code) : null,
    actorName: String(row.actor_name || "系统"),
    action: String(row.action),
    detail: String(row.detail),
    createdAt: String(row.created_at),
  };
}

function mapUser(row: Row): UserRecord {
  const role = String(row.role) as RoleKey;
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    department: String(row.department),
    role,
    roleLabel: roleLabels[role],
    active: Boolean(row.active),
    currentLoad: Number(row.current_load),
  };
}

function mapCustomer(row: Row): Customer {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    industry: String(row.industry),
    contact: String(row.contact),
    phone: String(row.phone),
    tier: String(row.tier),
    activeProjects: Number(row.active_projects || 0),
  };
}

function mapOrder(row: Row): SalesOrder {
  return {
    id: String(row.id),
    orderNo: String(row.order_no),
    customerId: String(row.customer_id),
    customerName: String(row.customer_name || ""),
    productModel: String(row.product_model),
    quantity: Number(row.quantity),
    amount: Number(row.amount),
    currency: String(row.currency),
    deliveryDate: String(row.delivery_date),
    status: String(row.status),
    projectId: row.project_id ? String(row.project_id) : null,
    projectCode: row.project_code ? String(row.project_code) : null,
    projectName: row.project_name ? String(row.project_name) : null,
  };
}

function mapDocument(row: Row): DocumentRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    formCode: String(row.form_code),
    fileName: String(row.file_name),
    objectKey: String(row.object_key),
    contentType: String(row.content_type),
    size: Number(row.size),
    version: String(row.version),
    uploadedBy: String(row.uploaded_by),
    createdAt: String(row.created_at),
  };
}

function mapFormRecord(row: Row): FormRecord {
  let payload: Record<string, string | number | boolean> = {};
  try {
    payload = JSON.parse(String(row.payload));
  } catch {
    payload = {};
  }
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    formCode: String(row.form_code),
    status: String(row.status),
    version: Number(row.version),
    updatedBy: String(row.updated_by),
    updatedAt: String(row.updated_at),
    payload,
  };
}

export function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

export async function addActivity(
  database: D1Database,
  projectId: string | null,
  actorId: string,
  action: string,
  detail: string,
) {
  await database
    .prepare("INSERT INTO activities (id,project_id,actor_id,action,detail) VALUES (?,?,?,?,?)")
    .bind(makeId("ac"), projectId, actorId, action, detail)
    .run();
}

export async function createProject(
  input: {
    name: string;
    productModel: string;
    category: string;
    source: string;
    customerId: string;
    orderId?: string | null;
    plannedEnd: string;
    budget: number;
    priority: string;
    description: string;
  },
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (
    !input.name?.trim() ||
    !input.productModel?.trim() ||
    !input.category?.trim() ||
    !input.source?.trim() ||
    !input.customerId?.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.plannedEnd)
  ) {
    throw new Error("项目名称、型号、类别、来源、客户和计划完成日为必填项。");
  }
  if (!Number.isFinite(input.budget) || input.budget < 0) {
    throw new Error("项目预算必须为有效的非负数。");
  }
  if (input.plannedEnd < currentDateIso()) {
    throw new Error("项目计划完成日不能早于当前日期。");
  }
  const sequence = await database
    .prepare("SELECT COUNT(*) + 24 AS next_number FROM projects")
    .first<{ next_number: number }>();
  const number = String(sequence?.next_number || 24).padStart(3, "0");
  const id = makeId("p");
  const code = `NP-${currentDateIso().slice(0, 4)}-${number}`;
  const start = currentDateIso();
  let customerId = input.customerId;
  if (input.orderId) {
    const order = await database
      .prepare(
        `SELECT o.customer_id, o.delivery_date, o.product_model,
          (SELECT COUNT(*) FROM projects p WHERE p.order_id=o.id) AS linked_count
         FROM sales_orders o WHERE o.id=?`,
      )
      .bind(input.orderId)
      .first<{
        customer_id: string;
        delivery_date: string;
        product_model: string;
        linked_count: number;
      }>();
    if (!order) throw new Error("关联订单不存在。");
    if (order.linked_count) throw new Error("该订单已经关联其他新品项目。");
    if (input.productModel.trim() !== order.product_model) {
      throw new Error(`项目型号必须与订单型号 ${order.product_model} 一致。`);
    }
    if (input.plannedEnd > order.delivery_date) {
      throw new Error(
        `项目计划完成日不能晚于订单交期 ${order.delivery_date}。`,
      );
    }
    customerId = order.customer_id;
  }
  await database
    .prepare(`INSERT INTO projects (
      id,code,name,product_model,motor_code,category,source,customer_id,order_id,
      owner_id,tracker_name,stage,status,progress,risk_level,planned_start,planned_end,
      budget,spent,target_cost,priority,description
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      id,
      code,
      input.name,
      input.productModel,
      "",
      input.category,
      input.source,
      customerId,
      input.orderId || null,
      user.id,
      user.name,
      "initiation",
      "planning",
      6,
      "low",
      start,
      input.plannedEnd,
      input.budget || 0,
      0,
      0,
      input.priority || "normal",
      input.description || "",
    )
    .run();

  const milestoneStatements = gateBlueprint.map((gate, index) => {
    const plannedDate = plannedGateDate(start, input.plannedEnd, index);
    return database
      .prepare(`INSERT INTO milestones (
        id,project_id,gate_code,name,department,owner_name,planned_date,status,
        progress,required_form,evidence_count,note,sort_order
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        makeId("ms"),
        id,
        gate[0],
        gate[1],
        gate[2],
        user.name,
        plannedDate,
        index === 0 ? "in_progress" : "not_started",
        index === 0 ? 35 : 0,
        gate[3],
        0,
        "",
        index + 1,
      );
  });
  await database.batch(milestoneStatements);
  await addActivity(database, id, user.id, "创建项目", `${code} ${input.name} 已建立并进入立项阶段`);
  return { id, code };
}

export async function createSalesOrder(
  input: {
    orderNo: string;
    customerId: string;
    productModel: string;
    quantity: number;
    amount: number;
    currency: string;
    deliveryDate: string;
  },
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (
    !input.orderNo?.trim() ||
    !input.customerId?.trim() ||
    !input.productModel?.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)
  ) {
    throw new Error("订单号、客户、产品型号和交期为必填项。");
  }
  if (
    !Number.isInteger(input.quantity) ||
    input.quantity <= 0 ||
    !Number.isFinite(input.amount) ||
    input.amount < 0
  ) {
    throw new Error("订单数量和金额必须为有效的非负数。");
  }
  if (!["CNY", "USD", "EUR"].includes(input.currency || "CNY")) {
    throw new Error("订单币种无效。");
  }
  const customer = await database
    .prepare("SELECT id FROM customers WHERE id=?")
    .bind(input.customerId)
    .first<{ id: string }>();
  if (!customer) throw new Error("订单客户不存在。");
  const duplicate = await database
    .prepare("SELECT id FROM sales_orders WHERE order_no=?")
    .bind(input.orderNo.trim())
    .first<{ id: string }>();
  if (duplicate) throw new Error("订单号已存在。");

  const id = makeId("o");
  await database
    .prepare(
      `INSERT INTO sales_orders
       (id,order_no,customer_id,product_model,quantity,amount,currency,delivery_date,status)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      input.orderNo.trim(),
      input.customerId,
      input.productModel.trim(),
      input.quantity,
      input.amount,
      input.currency || "CNY",
      input.deliveryDate,
      "confirmed",
    )
    .run();
  await addActivity(
    database,
    null,
    user.id,
    "新增订单",
    `${input.orderNo.trim()} · ${input.productModel.trim()} · ${input.quantity} 台`,
  );
  return { id };
}

export async function setProjectPaused(
  projectId: string,
  paused: boolean,
  reason: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (!reason.trim()) throw new Error("请填写暂停或恢复项目的说明。");
  const project = await database
    .prepare("SELECT * FROM projects WHERE id=?")
    .bind(projectId)
    .first<Row>();
  if (!project) throw new Error("项目不存在。");
  if (project.status === "completed" || project.status === "cancelled") {
    throw new Error("已完成或已终止项目不能暂停或恢复。");
  }
  await database
    .prepare(
      "UPDATE projects SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(paused ? "paused" : "active", projectId)
    .run();
  await addActivity(
    database,
    projectId,
    user.id,
    paused ? "暂停项目" : "恢复项目",
    `${project.code}：${reason.trim()}`,
  );
}

export async function terminateProject(
  projectId: string,
  reason: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (reason.trim().length < 12) {
    throw new Error("请完整说明终止原因、订单影响和资料处置。");
  }
  const project = await database
    .prepare("SELECT * FROM projects WHERE id=?")
    .bind(projectId)
    .first<Row>();
  if (!project) throw new Error("项目不存在。");
  if (project.status === "completed" || project.status === "cancelled") {
    throw new Error("项目已完成或已终止。");
  }
  await database
    .prepare(
      `UPDATE projects
       SET status='cancelled', actual_end=?, updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
    )
    .bind(currentDateIso(), projectId)
    .run();
  await database
    .prepare(
      `UPDATE milestones
       SET status=CASE WHEN status IN ('completed','waived') THEN status ELSE 'blocked' END,
           note=CASE WHEN status IN ('completed','waived') THEN note
                     ELSE '项目已终止：' || ? END,
           updated_at=CURRENT_TIMESTAMP
       WHERE project_id=?`,
    )
    .bind(reason.trim(), projectId)
    .run();
  await database
    .prepare(
      `UPDATE approvals
       SET status='rejected', decision_at=CURRENT_TIMESTAMP,
           decision_by=?, comment='项目终止，审批自动关闭：' || ?,
           updated_at=CURRENT_TIMESTAMP
       WHERE project_id=? AND status='pending'`,
    )
    .bind(user.id, reason.trim(), projectId)
    .run();
  await database
    .prepare(
      `UPDATE change_requests
       SET status='rejected', updated_at=CURRENT_TIMESTAMP
       WHERE project_id=? AND status IN ('draft','under_review')`,
    )
    .bind(projectId)
    .run();
  await addActivity(
    database,
    projectId,
    user.id,
    "终止项目",
    `${project.code}：${reason.trim()}`,
  );
}

export async function setOrderLink(
  orderId: string,
  projectId: string | null,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  const order = await database
    .prepare("SELECT * FROM sales_orders WHERE id=?")
    .bind(orderId)
    .first<Row>();
  if (!order) throw new Error("订单不存在。");
  const currentlyLinked = await database
    .prepare("SELECT id, code, name FROM projects WHERE order_id=?")
    .bind(orderId)
    .first<Row>();

  if (!projectId) {
    if (!currentlyLinked) throw new Error("该订单尚未关联项目。");
    await database
      .prepare(
        "UPDATE projects SET order_id=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(currentlyLinked.id)
      .run();
    await addActivity(
      database,
      String(currentlyLinked.id),
      user.id,
      "解除订单关联",
      `${order.order_no} 已与 ${currentlyLinked.code} 解除关联`,
    );
    return;
  }

  if (currentlyLinked && String(currentlyLinked.id) !== projectId) {
    throw new Error(`订单已关联项目 ${currentlyLinked.code}。`);
  }
  const project = await database
    .prepare("SELECT * FROM projects WHERE id=?")
    .bind(projectId)
    .first<Row>();
  if (!project) throw new Error("项目不存在。");
  if (project.status === "completed") throw new Error("已完成项目不能重新关联订单。");
  if (project.order_id && String(project.order_id) !== orderId) {
    throw new Error("该项目已经关联其他订单。");
  }
  if (String(project.product_model) !== String(order.product_model)) {
    throw new Error(
      `订单型号 ${order.product_model} 与项目型号 ${project.product_model} 不一致。`,
    );
  }
  if (String(project.planned_end) > String(order.delivery_date)) {
    throw new Error(
      `项目计划完成日晚于订单交期 ${order.delivery_date}，请先调整计划。`,
    );
  }

  await database
    .prepare(
      "UPDATE projects SET order_id=?, customer_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(orderId, order.customer_id, projectId)
    .run();
  await addActivity(
    database,
    projectId,
    user.id,
    "关联订单",
    `${order.order_no} 已关联 ${project.code}，交期 ${order.delivery_date}`,
  );
}

export async function updateMilestone(
  milestoneId: string,
  status: GateStatus,
  progress: number,
  note: string,
  plannedDate: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (
    !["not_started", "in_progress", "blocked", "completed"].includes(status)
  ) {
    throw new Error("无效的里程碑状态。");
  }
  if (!Number.isFinite(progress)) throw new Error("进度必须为有效数字。");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) {
    throw new Error("计划日期格式无效。");
  }
  if (!note.trim()) throw new Error("请填写阶段进展、阻塞原因或放行说明。");
  const milestone = await database
    .prepare(
      `SELECT m.*, p.category
        , p.status AS project_status
       FROM milestones m JOIN projects p ON p.id=m.project_id
       WHERE m.id=?`,
    )
    .bind(milestoneId)
    .first<Row>();
  if (!milestone) throw new Error("未找到该里程碑。");
  if (
    milestone.project_status === "paused" ||
    milestone.project_status === "completed" ||
    milestone.project_status === "cancelled"
  ) {
    throw new Error("暂停、已完成或已终止项目不能更新阶段进度。");
  }

  if (status !== "not_started") {
    const previous = await database
      .prepare(
        `SELECT name FROM milestones
         WHERE project_id=? AND sort_order < ? AND status NOT IN ('completed','waived')
         ORDER BY sort_order DESC LIMIT 1`,
      )
      .bind(milestone.project_id, milestone.sort_order)
      .first<{ name: string }>();
    if (previous) {
      throw new Error(`请先完成前序关口“${previous.name}”。`);
    }
  }
  const previousDate = await database
    .prepare(
      `SELECT name, planned_date FROM milestones
       WHERE project_id=? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1`,
    )
    .bind(milestone.project_id, milestone.sort_order)
    .first<{ name: string; planned_date: string }>();
  const nextDate = await database
    .prepare(
      `SELECT name, planned_date FROM milestones
       WHERE project_id=? AND sort_order > ? ORDER BY sort_order LIMIT 1`,
    )
    .bind(milestone.project_id, milestone.sort_order)
    .first<{ name: string; planned_date: string }>();
  if (previousDate && plannedDate < previousDate.planned_date) {
    throw new Error(`计划日期不能早于前序关口“${previousDate.name}”。`);
  }
  if (nextDate && plannedDate > nextDate.planned_date) {
    throw new Error(`计划日期不能晚于后续关口“${nextDate.name}”。`);
  }

  if (status === "completed") {

    const missingForms: string[] = [];
    for (const formCode of requiredFormsForGate(
      String(milestone.gate_code),
      String(milestone.category),
    )) {
      const form = await database
        .prepare(
          `SELECT status FROM form_records
           WHERE project_id=? AND form_code=?
           ORDER BY version DESC LIMIT 1`,
        )
        .bind(milestone.project_id, formCode)
        .first<{ status: string }>();
      if (form?.status !== "approved") missingForms.push(formCode);
    }
    if (missingForms.length) {
      throw new Error(
        `关口放行前，表单 ${missingForms.join("、")} 必须完成审批。`,
      );
    }
    if (
      ["verification", "confirmation", "release"].includes(
        String(milestone.gate_code),
      ) &&
      Number(milestone.evidence_count) < 1
    ) {
      throw new Error("关口放行前必须上传至少 1 份验证或确认附件。");
    }
  }

  const normalizedProgress =
    status === "completed"
      ? 100
      : status === "not_started"
        ? 0
        : Math.max(0, Math.min(99, progress));
  const actualDate = status === "completed" ? currentDateIso() : null;
  await database
    .prepare(
      "UPDATE milestones SET status=?, progress=?, note=?, planned_date=?, actual_date=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(
      status,
      normalizedProgress,
      note.trim(),
      plannedDate,
      actualDate,
      milestoneId,
    )
    .run();

  const aggregate = await database
    .prepare(
      "SELECT ROUND(AVG(progress)) AS progress FROM milestones WHERE project_id = ? AND gate_code <> 'change'",
    )
    .bind(milestone.project_id)
    .first<{ progress: number }>();
  if (status === "completed") {
    const next = await database
      .prepare(
        `SELECT gate_code FROM milestones
         WHERE project_id=? AND sort_order > ? AND gate_code <> 'change'
           AND status NOT IN ('completed','waived')
         ORDER BY sort_order LIMIT 1`,
      )
      .bind(milestone.project_id, milestone.sort_order)
      .first<{ gate_code: string }>();
    if (String(milestone.gate_code) === "release") {
      await database
        .prepare(
          "UPDATE projects SET stage='release', status='completed', progress=100, actual_end=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(actualDate, milestone.project_id)
        .run();
    } else {
      await database
        .prepare(
          "UPDATE projects SET stage=?, status='active', progress=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .bind(
          next?.gate_code || String(milestone.gate_code),
          aggregate?.progress || 0,
          milestone.project_id,
        )
        .run();
    }
  } else {
    await database
      .prepare(
        "UPDATE projects SET progress=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(aggregate?.progress || 0, milestone.project_id)
      .run();
  }
  if (status === "blocked") {
    await database
      .prepare(
        `UPDATE projects
         SET risk_level=CASE WHEN risk_level='low' THEN 'medium' ELSE risk_level END,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .bind(milestone.project_id)
      .run();
  }
  await addActivity(
    database,
    String(milestone.project_id),
    user.id,
    "更新进度",
    `${milestone.name} 更新为 ${
      status === "completed"
        ? "已完成"
        : status === "blocked"
          ? "受阻"
          : status === "not_started"
            ? "未开始"
            : "进行中"
    }（${normalizedProgress}%），计划 ${plannedDate}`,
  );
}

export async function waiveMilestone(
  milestoneId: string,
  reason: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (!reason.trim()) throw new Error("请填写阶段裁剪的风险依据和批准意见。");
  const milestone = await database
    .prepare(
      `SELECT m.*, p.category, p.code AS project_code,
        p.status AS project_status
       FROM milestones m JOIN projects p ON p.id=m.project_id
       WHERE m.id=?`,
    )
    .bind(milestoneId)
    .first<Row>();
  if (!milestone) throw new Error("未找到该里程碑。");
  if (
    milestone.project_status !== "active" &&
    milestone.project_status !== "planning"
  ) {
    throw new Error("只有在研项目可以裁剪开发阶段。");
  }
  if (milestone.category === "全新产品") {
    throw new Error("全新产品必须执行完整开发流程，不能裁剪阶段。");
  }
  if (["initiation", "planning", "release"].includes(String(milestone.gate_code))) {
    throw new Error("立项、设计任务和定型下发属于不可裁剪关口。");
  }
  if (milestone.status === "completed" || milestone.status === "waived") {
    throw new Error("该关口已完成或已裁剪。");
  }

  await database
    .prepare(
      `UPDATE milestones
       SET status='waived', progress=100, actual_date=?, note=?,
           updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    )
    .bind(
      currentDateIso(),
      `阶段裁剪（${user.name}批准）：${reason.trim()}`,
      milestoneId,
    )
    .run();
  const next = await database
    .prepare(
      `SELECT gate_code FROM milestones
       WHERE project_id=? AND gate_code <> 'change'
         AND status NOT IN ('completed','waived')
       ORDER BY sort_order LIMIT 1`,
    )
    .bind(milestone.project_id)
    .first<{ gate_code: string }>();
  const aggregate = await database
    .prepare(
      "SELECT ROUND(AVG(progress)) AS progress FROM milestones WHERE project_id=? AND gate_code <> 'change'",
    )
    .bind(milestone.project_id)
    .first<{ progress: number }>();
  await database
    .prepare(
      "UPDATE projects SET stage=?, progress=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(
      next?.gate_code || String(milestone.gate_code),
      aggregate?.progress || 0,
      milestone.project_id,
    )
    .run();
  await addActivity(
    database,
    String(milestone.project_id),
    user.id,
    "裁剪开发阶段",
    `${milestone.project_code} · ${milestone.name}：${reason.trim()}`,
  );
}

export async function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  comment: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("无效的审批结论。");
  }
  if (!comment.trim()) throw new Error("请填写审批意见。");
  const approval = await database
    .prepare("SELECT * FROM approvals WHERE id=?")
    .bind(approvalId)
    .first<Row>();
  if (!approval) throw new Error("未找到该审批。");
  if (approval.status !== "pending") throw new Error("该审批已处理。");
  if (
    user.role !== "system_admin" &&
    user.role !== String(approval.approver_role)
  ) {
    throw new Error(
      `该事项须由${roleLabels[String(approval.approver_role) as RoleKey]}处理。`,
    );
  }

  await database
    .prepare("UPDATE approvals SET status=?, decision_at=CURRENT_TIMESTAMP, decision_by=?, comment=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(decision, user.id, comment, approvalId)
    .run();
  await database
    .prepare("UPDATE form_records SET status=?, updated_at=CURRENT_TIMESTAMP, updated_by=? WHERE project_id=? AND form_code=?")
    .bind(decision, user.name, approval.project_id, approval.form_code)
    .run();
  await addActivity(
    database,
    String(approval.project_id),
    user.id,
    decision === "approved" ? "审批通过" : "审批退回",
    `${approval.title}：${comment || (decision === "approved" ? "同意" : "请补充资料")}`,
  );
}

export async function createChangeRequest(
  input: {
    projectId: string;
    changeType: string;
    title: string;
    reason: string;
    affectedObject: string;
    supplierNotice: boolean;
    customerNotice: boolean;
    disposition: string;
    dueDate: string;
  },
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (
    !input.projectId?.trim() ||
    !input.changeType?.trim() ||
    !input.title?.trim() ||
    !input.reason?.trim() ||
    !input.affectedObject?.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)
  ) {
    throw new Error("项目、变更类型、标题、原因、影响对象和期限为必填项。");
  }
  const changeProject = await database
    .prepare("SELECT status FROM projects WHERE id=?")
    .bind(input.projectId)
    .first<{ status: string }>();
  if (!changeProject) throw new Error("关联项目不存在。");
  if (changeProject.status === "cancelled") {
    throw new Error("已终止项目不能发起新变更。");
  }
  const sequence = await database
    .prepare("SELECT COUNT(*) + 52 AS next_number FROM change_requests")
    .first<{ next_number: number }>();
  const number = String(sequence?.next_number || 52).padStart(3, "0");
  const changeNo = `ECN-${currentDateIso().slice(0, 4)}-${number}`;
  await database
    .prepare(`INSERT INTO change_requests (
      id,change_no,project_id,change_type,title,reason,initiator_id,affected_object,
      supplier_notice,customer_notice,disposition,status,due_date
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(
      makeId("cr"),
      changeNo,
      input.projectId,
      input.changeType,
      input.title,
      input.reason,
      user.id,
      input.affectedObject,
      input.supplierNotice ? 1 : 0,
      input.customerNotice ? 1 : 0,
      input.disposition,
      "under_review",
      input.dueDate,
    )
    .run();
  await addActivity(database, input.projectId, user.id, "发起变更", `${changeNo} ${input.title}`);
  return { changeNo };
}

export async function decideChangeRequest(
  changeId: string,
  decision: "approved" | "rejected",
  comment: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("无效的变更评审结论。");
  }
  if (!comment.trim()) throw new Error("请填写变更评审意见。");
  const change = await database
    .prepare("SELECT * FROM change_requests WHERE id=?")
    .bind(changeId)
    .first<Row>();
  if (!change) throw new Error("未找到该变更申请。");
  if (change.status !== "under_review") throw new Error("该变更已处理或尚未提交。");

  await database
    .prepare(
      "UPDATE change_requests SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(decision, changeId)
    .run();
  await addActivity(
    database,
    String(change.project_id),
    user.id,
    decision === "approved" ? "批准变更" : "退回变更",
    `${change.change_no} ${change.title}：${comment || (decision === "approved" ? "同意执行" : "请补充影响分析")}`,
  );
}

export async function verifyChangeRequest(
  changeId: string,
  verification: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (!verification.trim()) throw new Error("请填写实施与验证结果。");
  const change = await database
    .prepare("SELECT * FROM change_requests WHERE id=?")
    .bind(changeId)
    .first<Row>();
  if (!change) throw new Error("未找到该变更申请。");
  if (change.status !== "approved") {
    throw new Error("只有已批准的变更才能完成实施验证。");
  }
  await database
    .prepare(
      "UPDATE change_requests SET status='verified', updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(changeId)
    .run();
  await addActivity(
    database,
    String(change.project_id),
    user.id,
    "变更验证归档",
    `${change.change_no} ${change.title}：${verification.trim()}`,
  );
}

export async function createIssue(
  input: {
    projectId: string;
    title: string;
    category: string;
    severity: RiskLevel;
    ownerId: string;
    dueDate: string;
  },
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (
    !input.projectId?.trim() ||
    !input.title?.trim() ||
    !input.category?.trim() ||
    !input.ownerId?.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) ||
    !["low", "medium", "high", "critical"].includes(input.severity)
  ) {
    throw new Error("问题标题、类别、严重度、责任人和期限为必填项。");
  }
  const project = await database
    .prepare("SELECT id, risk_level, status FROM projects WHERE id=?")
    .bind(input.projectId)
    .first<{ id: string; risk_level: RiskLevel; status: string }>();
  if (!project) throw new Error("关联项目不存在。");
  if (project.status === "completed" || project.status === "cancelled") {
    throw new Error("已完成或已终止项目不能新增开发问题。");
  }
  const owner = await database
    .prepare("SELECT id, name FROM users WHERE id=? AND active=1")
    .bind(input.ownerId)
    .first<{ id: string; name: string }>();
  if (!owner) throw new Error("问题责任人不存在或已停用。");

  await database
    .prepare(
      `INSERT INTO issues
       (id,project_id,title,category,severity,owner_id,status,due_date,resolution)
       VALUES (?,?,?,?,?,?, 'open', ?, '')`,
    )
    .bind(
      makeId("is"),
      input.projectId,
      input.title.trim(),
      input.category.trim(),
      input.severity,
      input.ownerId,
      input.dueDate,
    )
    .run();
  const riskRank: Record<RiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };
  if (riskRank[input.severity] > riskRank[project.risk_level]) {
    await database
      .prepare(
        "UPDATE projects SET risk_level=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      )
      .bind(input.severity, input.projectId)
      .run();
  }
  await addActivity(
    database,
    input.projectId,
    user.id,
    "新增问题",
    `${input.title.trim()} · ${riskLabelsForActivity(input.severity)} · 责任人 ${owner.name}`,
  );
}

export async function resolveIssue(
  issueId: string,
  resolution: string,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (!resolution.trim()) throw new Error("请填写解决措施与验证结果。");
  const issue = await database
    .prepare("SELECT * FROM issues WHERE id=?")
    .bind(issueId)
    .first<Row>();
  if (!issue) throw new Error("未找到该问题。");
  await database
    .prepare("UPDATE issues SET status='closed', resolution=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(resolution, issueId)
    .run();
  await addActivity(
    database,
    String(issue.project_id),
    user.id,
    "关闭问题",
    `${issue.title}：${resolution}`,
  );
}

export async function saveFormRecord(
  projectId: string,
  formCode: string,
  payload: Record<string, unknown>,
  submit: boolean,
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  const definition = formDefinitions.find((item) => item.code === formCode);
  if (!projectId || !definition) {
    throw new Error("项目或受控表单编号无效。");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("表单内容格式无效。");
  }
  const projectExists = await database
    .prepare("SELECT id, status FROM projects WHERE id=?")
    .bind(projectId)
    .first<{ id: string; status: string }>();
  if (!projectExists) throw new Error("关联项目不存在。");
  if (
    projectExists.status === "completed" ||
    projectExists.status === "cancelled"
  ) {
    throw new Error("已完成或已终止项目的表单只能查看，不能修改。");
  }
  if (submit) {
    const missing = definition.fields.filter((field) => {
      if (!field.required) return false;
      const value = payload[field.key];
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && !value.trim()) ||
        (typeof value === "number" && !Number.isFinite(value))
      );
    });
    if (missing.length) {
      throw new Error(
        `请先完成必填项：${missing
          .slice(0, 3)
          .map((field) => field.label)
          .join("、")}${missing.length > 3 ? "等" : ""}。`,
      );
    }
  }
  if (submit) {
    const pending = await database
      .prepare(
        "SELECT id FROM approvals WHERE project_id=? AND form_code=? AND status='pending' LIMIT 1",
      )
      .bind(projectId, formCode)
      .first<{ id: string }>();
    if (pending) {
      throw new Error("该表单已有待处理审批，请勿重复提交。");
    }
  }
  const existing = await database
    .prepare("SELECT * FROM form_records WHERE project_id=? AND form_code=? ORDER BY version DESC LIMIT 1")
    .bind(projectId, formCode)
    .first<Row>();
  const status = submit ? "submitted" : "draft";
  if (existing) {
    await database
      .prepare("UPDATE form_records SET payload=?, status=?, version=version+1, updated_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(JSON.stringify(payload), status, user.name, existing.id)
      .run();
  } else {
    await database
      .prepare("INSERT INTO form_records (id,project_id,form_code,status,version,payload,updated_by) VALUES (?,?,?,?,?,?,?)")
      .bind(makeId("fr"), projectId, formCode, status, 1, JSON.stringify(payload), user.name)
      .run();
  }
  if (submit) {
    const approverRole =
      formCode === "HD/JL-SJ-01A1" || formCode === "HD/JL-SJ-08A1"
        ? "management"
        : "technical_director";
    await database
      .prepare("INSERT INTO approvals (id,project_id,title,form_code,form_name,submitter_id,approver_role,status,submitted_at,due_at,comment) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(
        makeId("ap"),
        projectId,
        `${formCode} 表单审批`,
        formCode,
        definition?.name || formCode,
        user.id,
        approverRole,
        "pending",
        currentTimestamp(),
        addDaysIso(currentDateIso(), 2),
        "在线表单已提交，请审核。",
      )
      .run();
  }
  await addActivity(
    database,
    projectId,
    user.id,
    submit ? "提交表单" : "保存表单",
    `${formCode} 已${submit ? "提交审批" : "保存草稿"}`,
  );
}

export async function insertDocument(
  input: {
    projectId: string;
    formCode: string;
    fileName: string;
    objectKey: string;
    contentType: string;
    size: number;
  },
  user: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  const project = await database
    .prepare("SELECT id FROM projects WHERE id=?")
    .bind(input.projectId)
    .first<{ id: string }>();
  if (!project) throw new Error("文件关联的项目不存在。");
  if (
    input.formCode &&
    !formDefinitions.some((definition) => definition.code === input.formCode)
  ) {
    throw new Error("文件关联的受控表单编号无效。");
  }
  const id = makeId("doc");
  await database
    .prepare("INSERT INTO documents (id,project_id,form_code,file_name,object_key,content_type,size,version,uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(
      id,
      input.projectId,
      input.formCode,
      input.fileName,
      input.objectKey,
      input.contentType,
      input.size,
      "A1",
      user.name,
    )
    .run();
  await database
    .prepare(
      "UPDATE milestones SET evidence_count=evidence_count+1, updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND required_form=?",
    )
    .bind(input.projectId, input.formCode)
    .run();
  await addActivity(database, input.projectId, user.id, "上传文件", input.fileName);
  return id;
}

export async function updateUserAccess(
  input: {
    userId: string;
    role: RoleKey;
    department: string;
    active: boolean;
  },
  actor: CurrentUser,
) {
  await ensureDatabase();
  const database = getDatabase();
  if (!(input.role in roleLabels)) throw new Error("无效的岗位角色。");
  const target = await database
    .prepare("SELECT * FROM users WHERE id=?")
    .bind(input.userId)
    .first<Row>();
  if (!target) throw new Error("未找到该成员。");

  if (
    String(target.role) === "system_admin" &&
    (input.role !== "system_admin" || !input.active)
  ) {
    const admins = await database
      .prepare(
        "SELECT COUNT(*) AS count FROM users WHERE role='system_admin' AND active=1",
      )
      .first<{ count: number }>();
    if ((admins?.count || 0) <= 1) {
      throw new Error("必须保留至少一名启用状态的系统管理员。");
    }
  }

  await database
    .prepare(
      "UPDATE users SET role=?, department=?, active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
    .bind(
      input.role,
      input.department.trim() || String(target.department),
      input.active ? 1 : 0,
      input.userId,
    )
    .run();
  await addActivity(
    database,
    null,
    actor.id,
    "调整人员权限",
    `${target.name} 设置为${roleLabels[input.role]}，账号${input.active ? "启用" : "停用"}`,
  );
}

export async function getDocument(documentId: string) {
  await ensureDatabase();
  const database = getDatabase();
  const row = await database
    .prepare("SELECT * FROM documents WHERE id=?")
    .bind(documentId)
    .first<Row>();
  return row ? mapDocument(row) : null;
}

function currentDateIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function currentTimestamp() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function plannedGateDate(start: string, end: string, gateIndex: number) {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const totalDays = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / 86400000),
  );
  const ratio = gateScheduleRatios[gateIndex] ?? 1;
  startDate.setUTCDate(startDate.getUTCDate() + Math.round(totalDays * ratio));
  return startDate.toISOString().slice(0, 10);
}

function riskLabelsForActivity(risk: RiskLevel) {
  return {
    low: "低风险",
    medium: "中风险",
    high: "高风险",
    critical: "严重风险",
  }[risk];
}

function requiredFormsForGate(gateCode: string, category: string) {
  const requirements: Record<string, string[]> = {
    initiation: ["HD/JL-SJ-01A1"],
    planning:
      category === "全新产品"
        ? ["HD/JL-SJ-02A1", "HD/JL-SJ-03A1"]
        : ["HD/JL-SJ-02A1"],
    input_review: ["HD/JL-SJ-04A1"],
    design_output: ["HD/JL-SJ-10A1"],
    design_review: ["HD/JL-SJ-05A1"],
    verification: ["HD/JL-SJ-06A1"],
    confirmation: ["HD/JL-SJ-07A1"],
    release: ["HD/JL-SJ-08A1"],
    change: ["HD/JL-SJ-09A1"],
  };
  return requirements[gateCode] || [];
}
