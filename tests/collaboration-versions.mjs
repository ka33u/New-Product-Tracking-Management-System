import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkCollaborationVersions(database = new D1Adapter()) {
  const store = await buildStoreModule(database);
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const projectId = "npd-p-001";
  const data = await store.getNpdProjectArchiveData(projectId, admin);
  const member = () => database.prepare("SELECT * FROM npd_project_members WHERE project_id=? AND user_id=?").bind(projectId, admin.id).first();
  const baseline = (row) => row ? { id: row.id, version: row.version } : null;
  const before = await member();
  await store.assignProjectMember(projectId, admin.id, "最初职责", admin, baseline(before));
  const original = await member();
  assert.equal(original.version, before ? before.version + 1 : 1);
  await store.assignProjectMember(projectId, admin.id, "中间职责", admin, baseline(original));
  await store.assignProjectMember(projectId, admin.id, "最初职责", admin, baseline(await member()));
  assert.equal((await member()).responsibility, original.responsibility);
  assert.equal((await member()).version, original.version + 2);
  const count = async () => (await database.prepare("SELECT COUNT(*) n FROM npd_activities").first()).n;
  let auditCount = await count();
  await assert.rejects(() => store.assignProjectMember(projectId, admin.id, "旧窗口覆盖", admin, baseline(original)), { name: "NpdConflictError" });
  await assert.rejects(() => store.assignProjectMember(projectId, admin.id, "缺少版本", admin), { name: "NpdConflictError" });
  await assert.rejects(() => store.assignProjectMember(projectId, admin.id, "旧新增窗口", admin, null), { name: "NpdConflictError" });
  assert.equal(await count(), auditCount);
  assert.equal((await member()).responsibility, original.responsibility);
  const same = baseline(await member());
  const duplicates = await Promise.allSettled([1, 2].map(() => store.assignProjectMember(projectId, admin.id, "相同职责双提交", admin, same)));
  assert.equal(duplicates.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(duplicates.find((result) => result.status === "rejected").reason.name, "NpdConflictError");
  assert.equal((await member()).version, same.version + 1);
  assert.equal(await count(), auditCount + 1);
  const order = await store.createNpdSalesOrder({ orderNo: "VERSION-ORDER", customerId: data.project.customerId,
    productSummary: "版本测试电机", quantity: 1, amount: 100, currency: "CNY", orderDate: "2026-09-07", deliveryDate: "2027-01-01" }, admin);
  const orderRow = () => database.prepare("SELECT * FROM npd_sales_orders WHERE id=?").bind(order.id).first();
  const originalOrder = await orderRow();
  assert.equal(originalOrder.version, 1);
  await store.linkNpdSalesOrder(order.id, projectId, admin, null, 1);
  await store.linkNpdSalesOrder(order.id, null, admin, projectId, 2);
  assert.equal((await orderRow()).project_id, null);
  assert.equal((await orderRow()).version, 3);
  auditCount = await count();
  await assert.rejects(() => store.linkNpdSalesOrder(order.id, projectId, admin, null, 1), { name: "NpdConflictError" });
  await assert.rejects(() => store.linkNpdSalesOrder(order.id, projectId, admin, null), /有效版本号/);
  assert.equal(await count(), auditCount);
  const orderDuplicates = await Promise.allSettled([1, 2].map(() => store.linkNpdSalesOrder(order.id, projectId, admin, null, 3)));
  assert.equal(orderDuplicates.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await orderRow()).version, 4);
  assert.equal(await count(), auditCount + 1);
  const snapshot = await store.getNpdWorkspaceSnapshot(admin);
  assert.equal(snapshot.orders.find((row) => row.id === order.id).version, 4);
  assert.equal(snapshot.members.find((row) => row.id === same.id).version, same.version + 1);
  const audit = (await database.prepare("SELECT detail FROM npd_activities WHERE entity_id=? ORDER BY rowid DESC LIMIT 1").bind(order.id).first()).detail;
  assert.match(audit, /V3 → V4/);
  const newOrder = await store.createNpdSalesOrder({ orderNo: "VERSION-CREATE-ORDER", customerId: data.project.customerId,
    productSummary: "建项窗口旧订单", quantity: 1, amount: 0, currency: "CNY", orderDate: "2026-09-07", deliveryDate: "2027-01-01" }, admin);
  await store.linkNpdSalesOrder(newOrder.id, projectId, admin, null, 1);
  await store.linkNpdSalesOrder(newOrder.id, null, admin, projectId, 2);
  const userFor = (role) => snapshot.users.find((user) => user.role === role && user.active).id;
  const creation = { name: "版本保护建项", seriesName: "测试系列", category: "电机", source: "企业研发",
    customerId: data.project.customerId, ownerId: admin.id, processId: userFor("process"), procurementId: userFor("procurement"),
    productionId: userFor("production"), testerId: userFor("tester"), qualityId: userFor("quality"),
    plannedStart: "2026-09-07", plannedEnd: "2027-12-31", priority: "normal", riskLevel: "low", description: "隔离测试",
    motors: [{ ...data.motors[0], model: "CREATION-ORDER", plannedDate: "2027-01-01" }], orderIds: [newOrder.id] };
  const projectsBefore = (await database.prepare("SELECT COUNT(*) n FROM npd_projects").first()).n;
  auditCount = await count();
  await assert.rejects(() => store.createNpdProject({ ...creation, orderVersions: { [newOrder.id]: 1 } }, admin), { name: "NpdConflictError" });
  await assert.rejects(() => store.createNpdProject(creation, admin), /有效版本号/);
  assert.equal((await database.prepare("SELECT COUNT(*) n FROM npd_projects").first()).n, projectsBefore);
  assert.equal(await count(), auditCount);
  const newProject = await store.createNpdProject({ ...creation, orderVersions: { [newOrder.id]: 3 } }, admin);
  const claimedOrder = await database.prepare("SELECT project_id,version FROM npd_sales_orders WHERE id=?").bind(newOrder.id).first();
  assert.equal(claimedOrder.project_id, newProject.id); assert.equal(claimedOrder.version, 4);
  console.log("协作独立版本通过：成员/订单改回原值的旧窗口拒绝、缺版本零写入、相同并发仅一成功、接口数据与审计含版本。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkCollaborationVersions();
