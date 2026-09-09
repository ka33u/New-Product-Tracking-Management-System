import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkCleanDeployment(database) {
  let store = await buildStoreModule(database, { NPD_DEMO_DATA: "0" });
  await store.ensureNpdDatabase();
  async function count(table) { return (await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n; }
  for (const table of ["npd_users", "npd_customers", "npd_projects", "npd_sales_orders", "npd_project_members", "npd_activities"]) {
    assert.equal(await count(table), 0, `空白部署不得自动填充 ${table}`);
  }
  assert.equal((await store.getNpdLocalAuthState()).configured, false);
  const setup = await Promise.allSettled(["FirstAdmin2026", "SecondAdmin2026"].map((password) => store.setupNpdLocalAdmin({
    email: "owner@example.test", name: "企业管理员", department: "管理部", password,
  })));
  assert.equal(setup.filter((result) => result.status === "fulfilled").length, 1);
  const admin = setup.find((result) => result.status === "fulfilled").value.user;
  assert.equal(await count("npd_users"), 1);
  assert.equal(await count("npd_projects"), 0);
  assert.equal((await store.getNpdLocalAuthState()).configured, true);
  // Even an accidentally enabled demo flag must not seed an initialized company.
  store = await buildStoreModule(database, { NPD_DEMO_DATA: "1" });
  await store.ensureNpdDatabase();
  assert.equal(await count("npd_users"), 1);
  assert.equal(await count("npd_projects"), 0);
  const staff = {};
  for (const role of ["sales", "design", "process", "procurement", "production", "tester", "quality"]) {
    staff[role] = await store.createNpdUser({ email: `${role}@example.test`, name: `${role}负责人`, department: "企业部门",
      role, active: true, password: role === "sales" ? "SalesUser2026" : undefined }, admin);
  }
  const sales = (await store.authenticateNpdLocalUser(staff.sales.email, "SalesUser2026")).user;
  const customer = await store.saveNpdCustomer({ code: "KH-001", name: "企业首位客户", industry: "机械", contact: "客户联系人", phone: "010-12345678" }, sales);
  const order = await store.createNpdSalesOrder({ orderNo: "SO-001", customerId: customer.id, productSummary: "新系列电机",
    quantity: 1, amount: 12000, currency: "CNY", orderDate: "2026-09-06", deliveryDate: "2027-03-01" }, sales);
  const project = await store.createNpdProject({ name: "企业首个新品项目", seriesName: "首个系列", category: "异步电动机", source: "客户订单",
    customerId: customer.id, ownerId: staff.design.id, processId: staff.process.id, procurementId: staff.procurement.id,
    productionId: staff.production.id, testerId: staff.tester.id, qualityId: staff.quality.id,
    plannedStart: "2026-09-06", plannedEnd: "2027-03-01", priority: "normal", riskLevel: "medium", description: "首次真实录入流程", orderIds: [order.id], orderVersions: { [order.id]: 1 },
    motors: [{ model: "Y-FIRST-001", ratedPower: "5.5kW", voltage: "380V", frequency: "50Hz", poles: "4", speed: "1450r/min",
      frameSize: "132", mounting: "B3", terminalMode: "顶部出线", protectionGrade: "IP55", insulationClass: "F", coolingMethod: "IC411",
      quantity: 1, inspectionRequirement: "尺寸与装配全检", testRequirement: "温升和性能", plannedDate: "2027-02-01" }],
  }, sales);
  store = await buildStoreModule(database, { NPD_DEMO_DATA: "0" });
  await store.ensureNpdDatabase();
  const workspace = await store.getNpdWorkspaceSnapshot(admin);
  assert.equal(workspace.users.length, 8);
  assert.equal(workspace.customers.length, 1);
  assert.equal(workspace.projects.length, 1);
  assert.equal(workspace.projects[0].id, project.id);
  assert.equal(workspace.projects[0].initiatorId, sales.id);
  assert.equal(workspace.projects[0].ownerId, staff.design.id);
  assert.equal(workspace.sheets.length, 10);
  assert.equal(workspace.sheetRevisions.length, 10);
  assert.equal(workspace.members.length, 7);
  assert.equal(workspace.orders[0].projectId, project.id);
  assert.equal(workspace.users.some((user) => user.id.startsWith("npd-u-")), false);
  assert.equal((await store.getNpdWorkspaceSnapshot(staff.quality)).projects[0].id, project.id);
  console.log("空白部署通过：零演示数据、首位管理员并发初始化、真实人员/客户/订单/项目录入及重启保留。");
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkCleanDeployment(new D1Adapter());
