import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const typescriptRuntime =
  process.env.TYPESCRIPT_RUNTIME || require.resolve("typescript");
const ts = require(typescriptRuntime);

class Prepared {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new Prepared(this.database, this.sql, values);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    return this.database.prepare(this.sql).run(...this.values);
  }
}

class D1Adapter {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys=ON");
  }

  prepare(sql) {
    return new Prepared(this.database, sql);
  }

  async batch(statements) {
    const results = [];
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function transpile(source, fileName) {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  }).outputText;
}

async function buildStoreModule(database) {
  const context = vm.createContext({
    console,
    crypto,
    Date,
    Intl,
    JSON,
    Math,
    Object,
    Promise,
    Set,
    String,
    Number,
    Boolean,
    Array,
    Error,
    process: { env: { NODE_ENV: "development" } },
  });
  const sources = {
    "/db/store.ts": await readFile(new URL("../db/store.ts", import.meta.url), "utf8"),
    "/lib/forms.ts": await readFile(new URL("../lib/forms.ts", import.meta.url), "utf8"),
    "/lib/permissions.ts": await readFile(
      new URL("../lib/permissions.ts", import.meta.url),
      "utf8",
    ),
  };
  const modules = new Map();
  for (const [identifier, source] of Object.entries(sources)) {
    modules.set(
      identifier,
      new vm.SourceTextModule(transpile(source, identifier), {
        context,
        identifier,
      }),
    );
  }
  modules.set(
    "cloudflare:workers",
    new vm.SyntheticModule(
      ["env"],
      function initialize() {
        this.setExport("env", { DB: database });
      },
      { context, identifier: "cloudflare:workers" },
    ),
  );

  const resolve = (specifier, parent) => {
    if (specifier === "cloudflare:workers") return specifier;
    const base = new URL(parent, "file:///");
    const resolved = new URL(specifier, base);
    return `${resolved.pathname}.ts`;
  };
  const linker = async (specifier, referencingModule) => {
    const identifier = resolve(specifier, referencingModule.identifier);
    const target = modules.get(identifier);
    if (!target) {
      throw new Error(
        `Cannot resolve ${specifier} from ${referencingModule.identifier} (${identifier})`,
      );
    }
    return target;
  };
  await modules.get("/db/store.ts").link(linker);
  await modules.get("/db/store.ts").evaluate();
  return modules.get("/db/store.ts").namespace;
}

const database = new D1Adapter();
const store = await buildStoreModule(database);
await store.ensureDatabase();

const admin = await store.resolveCurrentUser(null, null);
assert.equal(admin.role, "system_admin");
let snapshot = await store.getWorkspaceSnapshot();
assert.equal(snapshot.projects.length, 5);
assert.equal(snapshot.users.length, 12);
assert.equal(snapshot.orders.length, 5);
assert.equal(snapshot.milestones.length, 45);

const newOrder = await store.createSalesOrder(
  {
    orderNo: "SO-TEST-001",
    customerId: "c-003",
    productModel: "YKK-355M-4",
    quantity: 2,
    amount: 280000,
    currency: "CNY",
    deliveryDate: "2027-12-20",
  },
  admin,
);
const newProject = await store.createProject(
  {
    name: "集成测试高温电机",
    productModel: "YKK-355M-4",
    category: "全新产品",
    source: "客户",
    customerId: "c-003",
    orderId: newOrder.id,
    plannedEnd: "2027-12-01",
    budget: 500000,
    priority: "high",
    description: "验证订单、表单、审批和阶段门的真实数据闭环。",
  },
  admin,
);

await store.saveFormRecord(
  newProject.id,
  "HD/JL-SJ-01A1",
  {
    source: "客户",
    productName: "集成测试高温电机",
    productModel: "YKK-355M-4",
    initiationDate: "2026-07-23",
    requiredDate: "2027-12-01",
    functionSummary: "高温循环风机驱动",
    performance: "满足技术协议和温升要求",
    innovation: "绝缘和冷却结构优化",
  },
  true,
  admin,
);
snapshot = await store.getWorkspaceSnapshot();
const initiationApproval = snapshot.approvals.find(
  (approval) =>
    approval.projectId === newProject.id &&
    approval.formCode === "HD/JL-SJ-01A1",
);
assert.ok(initiationApproval);
await store.decideApproval(
  initiationApproval.id,
  "approved",
  "立项资料齐套，同意进入设计策划。",
  admin,
);
snapshot = await store.getWorkspaceSnapshot();
const initiation = snapshot.milestones.find(
  (milestone) =>
    milestone.projectId === newProject.id && milestone.gateCode === "initiation",
);
await store.updateMilestone(
  initiation.id,
  "completed",
  100,
  "立项审批完成，项目团队与资源已确认。",
  initiation.plannedDate,
  admin,
);
snapshot = await store.getWorkspaceSnapshot();
assert.equal(
  snapshot.projects.find((project) => project.id === newProject.id).stage,
  "planning",
);

const planning = snapshot.milestones.find(
  (milestone) =>
    milestone.projectId === newProject.id && milestone.gateCode === "planning",
);
await assert.rejects(
  store.updateMilestone(
    planning.id,
    "completed",
    100,
    "尝试绕过必需的任务书和开发计划。",
    planning.plannedDate,
    admin,
  ),
  /HD\/JL-SJ-02A1.*HD\/JL-SJ-03A1/,
);

await store.createIssue(
  {
    projectId: newProject.id,
    title: "高温绝缘体系寿命数据待补充",
    category: "技术",
    severity: "high",
    ownerId: "u-design",
    dueDate: "2026-08-15",
  },
  admin,
);
snapshot = await store.getWorkspaceSnapshot();
const issue = snapshot.issues.find((item) => item.projectId === newProject.id);
assert.ok(issue);
await store.resolveIssue(issue.id, "补充供应商寿命曲线并完成设计复核。", admin);
await store.setProjectPaused(
  newProject.id,
  true,
  "等待客户确认高温工况边界。",
  admin,
);
await store.setProjectPaused(
  newProject.id,
  false,
  "客户边界已确认，恢复设计。",
  admin,
);

const change = await store.createChangeRequest(
  {
    projectId: "p-012",
    changeType: "更改图纸",
    title: "验证定型后变更闭环",
    reason: "集成测试验证定型项目仍可按受控流程变更",
    affectedObject: "总装图 TEST-001",
    supplierNotice: false,
    customerNotice: false,
    disposition: "用完止",
    dueDate: "2026-08-30",
  },
  admin,
);
snapshot = await store.getWorkspaceSnapshot();
const createdChange = snapshot.changes.find(
  (item) => item.changeNo === change.changeNo,
);
await store.decideChangeRequest(
  createdChange.id,
  "approved",
  "影响分析完整，同意实施。",
  admin,
);
await store.verifyChangeRequest(
  createdChange.id,
  "图纸与受控文件已换版，样件复测满足要求。",
  admin,
);

snapshot = await store.getWorkspaceSnapshot();
const derivationGate = snapshot.milestones.find(
  (milestone) =>
    milestone.projectId === "p-015" && milestone.gateCode === "confirmation",
);
await store.waiveMilestone(
  derivationGate.id,
  "派生产品沿用已验证电磁与结构方案，仅调整出口标识，客户试用证据覆盖确认风险。",
  admin,
);
await store.terminateProject(
  newProject.id,
  "客户取消订单技术方案，已通知销售、采购和制造，现有设计资料转入项目终止档案。",
  admin,
);
await store.setOrderLink(newOrder.id, null, admin);

snapshot = await store.getWorkspaceSnapshot();
assert.equal(
  snapshot.projects.find((project) => project.id === newProject.id).status,
  "cancelled",
);
assert.equal(
  snapshot.changes.find((item) => item.id === createdChange.id).status,
  "verified",
);
assert.equal(
  snapshot.milestones.find((item) => item.id === derivationGate.id).status,
  "waived",
);
assert.equal(
  snapshot.orders.find((order) => order.id === newOrder.id).projectId,
  null,
);

console.log(
  "Store integration OK:",
  `${snapshot.projects.length} projects,`,
  `${snapshot.orders.length} orders,`,
  `${snapshot.activities.length} recent audit events`,
);
