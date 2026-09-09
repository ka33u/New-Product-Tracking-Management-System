import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkRevisionTransactions(database) {
  const store = await buildStoreModule(database);
  async function updateUser(input, actor) {
    const expected = (await store.getNpdWorkspaceSnapshot(actor)).users.find((user) => user.id === input.userId);
    return store.updateNpdUser({ ...input, expected }, actor);
  }
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const preference = { periodMode: "month", periodValue: "2026-09", customStart: "", customEnd: "", visibleMetrics: ["total", "onTime", "overdue"] };
  await store.saveDashboardPreference(preference, admin);
  assert.deepEqual(JSON.parse(JSON.stringify((await store.getNpdWorkspaceSnapshot(admin)).dashboardPreference)), preference);
  const preferenceState = async () => JSON.stringify({
    preferences: (await database.prepare("SELECT * FROM npd_dashboard_preferences ORDER BY user_id").all()).results,
    audit: (await database.prepare("SELECT * FROM npd_activities ORDER BY id").all()).results,
  });
  const savedPreferences = await preferenceState();
  for (const invalid of [null, { ...preference, periodValue: "2026-13" }, { ...preference, visibleMetrics: ["not-a-metric"] },
    { ...preference, periodMode: "custom", customStart: "2026-09-30", customEnd: "2026-09-01" }]) {
    await assert.rejects(() => store.saveDashboardPreference(invalid, admin));
    assert.equal(await preferenceState(), savedPreferences, "无效看板配置不得改变偏好或留下成功审计");
  }
  await database.prepare(`CREATE TRIGGER npd_test_preference_failure BEFORE UPDATE ON npd_dashboard_preferences
    BEGIN SELECT RAISE(ABORT,'Injected preference failure'); END`).run();
  try {
    await assert.rejects(() => store.saveDashboardPreference({ ...preference, visibleMetrics: ["total"] }, admin), /Injected preference failure/);
    assert.equal(await preferenceState(), savedPreferences, "偏好保存失败必须回滚成功审计");
  } finally { await database.prepare("DROP TRIGGER npd_test_preference_failure").run(); }
  await database.prepare("UPDATE npd_dashboard_preferences SET payload=? WHERE user_id=?").bind('{"periodMode":"month","periodValue":"2026-99","visibleMetrics":null}', admin.id).run();
  const fallback = (await store.getNpdWorkspaceSnapshot(admin)).dashboardPreference;
  assert.equal(fallback.periodMode, "year");
  assert.ok(Array.isArray(fallback.visibleMetrics));
  await store.saveDashboardPreference(preference, admin);
  const projectId = "npd-p-001";
  const formCode = "HD/JL-SJ-01A1";
  const form = () => database.prepare("SELECT * FROM npd_form_records WHERE project_id=? AND form_code=?").bind(projectId, formCode).first();
  const sheet = () => database.prepare("SELECT * FROM npd_project_sheets WHERE project_id=? AND code='initiation'").bind(projectId).first();
  async function businessState() {
    const result = {};
    for (const table of ["npd_projects", "npd_form_records", "npd_project_sheets", "npd_sheet_revisions", "npd_activities", "npd_project_motors", "npd_part_items", "npd_documents", "npd_test_reports", "npd_inspection_records", "npd_project_members", "npd_sales_orders"]) {
      result[table] = (await database.prepare(`SELECT * FROM ${table} WHERE ${table === "npd_projects" ? "id" : "project_id"}=? ORDER BY id`).bind(projectId).all()).results;
    }
    return JSON.stringify(result);
  }
  const original = await form();
  const base = original?.version || 0;
  const results = await Promise.allSettled(["first", "second"].map((writer) =>
    store.saveNpdFormRecord(projectId, formCode, { writer }, false, admin, "并发修改测试", base)));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.name, "NpdConflictError");
  const winner = results.findIndex((result) => result.status === "fulfilled");
  const current = await form();
  assert.equal(current.version, base + 1);
  assert.equal(JSON.parse(current.payload).writer, ["first", "second"][winner]);
  const revision = await database.prepare("SELECT snapshot FROM npd_sheet_revisions WHERE project_id=? AND sheet_code='initiation' ORDER BY version DESC LIMIT 1").bind(projectId).first();
  const archived = JSON.parse(revision.snapshot).data.forms.find((item) => item.form_code === formCode);
  assert.equal(archived.payload, current.payload);
  assert.equal(archived.version, current.version);

  const stable = await businessState();
  await assert.rejects(() => store.saveNpdFormRecord(projectId, formCode, { writer: "stale" }, false, admin, "旧页面重试", base), { name: "NpdConflictError" });
  assert.equal(await businessState(), stable, "冲突不得产生任何领域数据、版本或审计变更");

  // Fail at the last project aggregate write, after form, audit, revisions and
  // downstream state changes have all executed inside the transaction.
  await database.prepare(`CREATE TRIGGER npd_test_transaction_failure BEFORE UPDATE ON npd_projects
    BEGIN SELECT RAISE(ABORT,'Injected transaction failure'); END`).run();
  try {
    await assert.rejects(() => store.saveNpdFormRecord(projectId, formCode, { writer: "failed" }, false, admin, "故障回滚测试", current.version), /Injected transaction failure/);
    assert.equal(await businessState(), stable, "任意最后一步故障必须回滚整个保存动作");
  } finally { await database.prepare("DROP TRIGGER npd_test_transaction_failure").run(); }

  const stageBase = await sheet();
  const stageInput = { progress: 30, plannedDate: stageBase.planned_date, note: "并发节点测试", changeReason: "节点调整", expectedVersion: stageBase.version };
  const stages = await Promise.allSettled(["blocked", "in_progress"].map((status) =>
    store.updateProjectSheet(projectId, "initiation", { ...stageInput, status }, admin)));
  assert.equal(stages.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(stages.find((result) => result.status === "rejected").reason.name, "NpdConflictError");
  assert.equal((await sheet()).version, stageBase.version + 1);
  const workspace = await store.getNpdWorkspaceSnapshot(admin);
  const motor = workspace.motors.find((row) => row.projectId === projectId);
  const motorInput = { ...motor, expectedRevision: motor.designRevision, changeReason: "并发电机变更测试" };
  const motorResults = await Promise.allSettled(["左侧出线", "右侧出线"].map((terminalMode) =>
    store.updateProjectMotor(motor.id, { ...motorInput, terminalMode }, admin)));
  assert.equal(motorResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(motorResults.find((result) => result.status === "rejected").reason.name, "NpdConflictError");
  const afterMotor = await businessState();
  await assert.rejects(() => store.updateMotorRequirements(motor.id, "旧版检验要求", "旧版试验要求", admin, motor.designRevision), { name: "NpdConflictError" });
  assert.equal(await businessState(), afterMotor);

  const part = workspace.parts.find((row) => row.projectId === projectId);
  assert.ok(part);
  const partInput = { ...part, expectedRevision: part.designRevision, changeReason: "零部件事务测试" };
  await database.prepare(`CREATE TRIGGER npd_test_transaction_failure BEFORE UPDATE ON npd_projects
    BEGIN SELECT RAISE(ABORT,'Injected transaction failure'); END`).run();
  try {
    const beforePart = await businessState();
    await assert.rejects(() => store.updatePartItem(part.id, { ...partInput, name: "不得留下此名称" }, admin), /Injected transaction failure/);
    assert.equal(await businessState(), beforePart, "失败不得清空原生产确认、修改零部件或留下版本记录");
  } finally { await database.prepare("DROP TRIGGER npd_test_transaction_failure").run(); }
  const partResults = await Promise.allSettled(["并发零件A", "并发零件B"].map((name) =>
    store.updatePartItem(part.id, { ...partInput, name }, admin)));
  assert.equal(partResults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(partResults.find((result) => result.status === "rejected").reason.name, "NpdConflictError");
  const addedMotorInput = { ...motorInput, model: "CONCURRENT-NEW-MOTOR" };
  const adds = await Promise.allSettled([0, 1].map(() => store.addProjectMotor(projectId, addedMotorInput, admin)));
  assert.equal(adds.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_project_motors WHERE project_id=? AND model=?").bind(projectId, addedMotorInput.model).first()).n, 1);
  const newPartInput = { ...partInput, projectId, partNo: "CONCURRENT-COMMON-PART", motorId: null };
  const partAdds = await Promise.allSettled([0, 1].map(() => store.addPartItem(newPartInput, admin)));
  assert.equal(partAdds.filter((result) => result.status === "fulfilled").length, 1);
  const newPart = await database.prepare("SELECT * FROM npd_part_items WHERE project_id=? AND part_no=?").bind(projectId, newPartInput.partNo).first();
  await assert.rejects(() => store.addPartItem(newPartInput, admin), /不能重复/);
  const partSheet = () => database.prepare("SELECT version FROM npd_project_sheets WHERE project_id=? AND code='parts_plan'").bind(projectId).first();
  const confirmationVersion = (await partSheet()).version;
  const confirmations = await Promise.allSettled([0, 1].map(() => store.confirmPartItem(newPart.id, "completed", "完成确认", admin, newPart.design_revision, confirmationVersion)));
  assert.equal(confirmations.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(confirmations.find((result) => result.status === "rejected").reason.name, "NpdConflictError");
  const fresh = (await store.getNpdWorkspaceSnapshot(admin)).parts.find((row) => row.id === newPart.id);
  await store.updatePartItem(newPart.id, { ...fresh, expectedRevision: fresh.designRevision, changeReason: "生产确认后的设计变更" }, admin);
  const afterDesign = await businessState();
  await assert.rejects(async () => store.confirmPartItem(newPart.id, "completed", "旧设计再次确认", admin, fresh.designRevision, (await partSheet()).version), { name: "NpdConflictError" });
  assert.equal(await businessState(), afterDesign);
  const revised = await database.prepare("SELECT status,confirmed_by FROM npd_part_items WHERE id=?").bind(newPart.id).first();
  assert.equal(revised.status, "planned");
  assert.equal(revised.confirmed_by, null);

  await database.prepare(`CREATE TRIGGER npd_test_transaction_failure BEFORE UPDATE ON npd_projects
    BEGIN SELECT RAISE(ABORT,'Injected transaction failure'); END`).run();
  try {
    const stableAdds = await businessState();
    await assert.rejects(() => store.addProjectMotor(projectId, { ...addedMotorInput, model: "FAILED-INSERT" }, admin), /Injected transaction failure/);
    await assert.rejects(() => store.addPartItem({ ...newPartInput, partNo: "FAILED-PART" }, admin), /Injected transaction failure/);
    await assert.rejects(async () => store.confirmPartItem(newPart.id, "completed", "失败的生产确认", admin, fresh.designRevision + 1, (await partSheet()).version), /Injected transaction failure/);
    assert.equal(await businessState(), stableAdds, "新增和生产确认的后续故障必须完整回滚");
  } finally { await database.prepare("DROP TRIGGER npd_test_transaction_failure").run(); }
  const reportMotor = await database.prepare("SELECT * FROM npd_project_motors WHERE id=?").bind(motor.id).first();
  // Attachment metadata only: fixtures never access the user's R2 objects.
  const attachment = { projectId, sheetCode: "verification", motorId: motor.id, linkedRecordId: null, kind: "test_report", fileName: "isolated-test.pdf", objectKey: "isolated-test", contentType: "application/pdf", size: 10 };
  const documentId = await store.insertNpdDocument(attachment, admin);
  const qualityDocument = await store.insertNpdDocument({ ...attachment, sheetCode: "quality_inspection", kind: "inspection_record", objectKey: "isolated-quality" }, admin);
  const reportInput = { projectId, motorId: motor.id, expectedRevision: reportMotor.design_revision, reportNo: "ATOMIC-REPORT-001", reportType: "型式试验", title: "事务测试报告", requirementRef: reportMotor.test_requirement, testDate: "2026-09-06", result: "合格", conclusion: "满足要求", documentId };
  const qualityInput = { projectId, motorId: motor.id, partItemId: null, itemType: "motor", expectedRevision: reportMotor.design_revision, inspectionDate: "2026-09-06", result: "合格", conclusion: "满足要求", documentId: qualityDocument };
  const beforeReports = await businessState();
  await assert.rejects(() => store.createTestReport({ ...reportInput, expectedRevision: reportMotor.design_revision - 1 }, admin), { name: "NpdConflictError" });
  await assert.rejects(() => store.createInspectionRecord({ ...qualityInput, expectedRevision: reportMotor.design_revision - 1 }, admin), { name: "NpdConflictError" });
  assert.equal(await businessState(), beforeReports);
  await database.prepare(`CREATE TRIGGER npd_test_transaction_failure BEFORE UPDATE ON npd_projects
    BEGIN SELECT RAISE(ABORT,'Injected transaction failure'); END`).run();
  try {
    await assert.rejects(() => store.createTestReport(reportInput, admin), /Injected transaction failure/);
    await assert.rejects(() => store.createInspectionRecord(qualityInput, admin), /Injected transaction failure/);
    await assert.rejects(() => store.insertNpdDocument({ ...attachment, objectKey: "must-not-survive" }, admin), /Injected transaction failure/);
    assert.equal(await businessState(), beforeReports, "报告、附件关联、附件索引、审计及版本必须全部回滚");
  } finally { await database.prepare("DROP TRIGGER npd_test_transaction_failure").run(); }
  const reportResults = await Promise.allSettled([1, 2].map(() => store.createTestReport(reportInput, admin)));
  assert.equal(reportResults.filter((result) => result.status === "fulfilled").length, 1);
  const qualityResults = await Promise.allSettled([1, 2].map(() => store.createInspectionRecord(qualityInput, admin)));
  assert.equal(qualityResults.filter((result) => result.status === "fulfilled").length, 1);
  const completedReports = await businessState();
  await assert.rejects(() => store.createTestReport({ ...reportInput, documentId: null }, admin), /报告编号/);
  await assert.rejects(() => store.createInspectionRecord(qualityInput, admin));
  assert.equal(await businessState(), completedReports);
  const backdatedReport = await store.createTestReport({ ...reportInput, reportNo: "BACKDATED-SUBMISSION", testDate: "2020-01-01", documentId: null }, admin);
  const orderedReports = (await store.getNpdWorkspaceSnapshot(admin)).testReports.filter((report) => report.motorId === motor.id);
  assert.equal(orderedReports[0].id, backdatedReport.id, "工作区报告顺序必须与放行判断一致，按提交顺序而非试验日期");
  const backdatedInspection = await store.createInspectionRecord({ ...qualityInput, inspectionDate: "2020-01-01", documentId: null }, admin);
  const orderedInspections = (await store.getNpdWorkspaceSnapshot(admin)).inspections.filter((record) => record.motorId === motor.id);
  assert.equal(orderedInspections[0].id, backdatedInspection.id, "质量记录按提交顺序而非检验日期排列");
  const memberFor = (role) => workspace.users.find((user) => user.role === role).id;
  const createInput = { name: "并发建项测试", seriesName: "事务测试系列", category: "异步电动机", source: "企业研发",
    customerId: "npd-c-001", ownerId: admin.id, processId: memberFor("process"), procurementId: memberFor("procurement"),
    productionId: memberFor("production"), testerId: memberFor("tester"), qualityId: memberFor("quality"),
    plannedStart: "2026-09-06", plannedEnd: "2027-06-01", priority: "normal", riskLevel: "medium", description: "隔离测试",
    motors: [{ ...addedMotorInput, model: "NEW-A" }, { ...addedMotorInput, model: "NEW-B" }], orderIds: [] };
  const createdPair = await Promise.all(["甲", "乙"].map((suffix) => store.createNpdProject({ ...createInput, name: createInput.name + suffix }, admin)));
  assert.notEqual(createdPair[0].code, createdPair[1].code, "并发创建不同项目应均成功且编号唯一");
  for (const created of createdPair) {
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_project_motors WHERE project_id=?").bind(created.id).first()).n, 2);
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_project_sheets WHERE project_id=?").bind(created.id).first()).n, 10);
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_sheet_revisions WHERE project_id=?").bind(created.id).first()).n, 10);
    const baseline = await database.prepare("SELECT snapshot FROM npd_sheet_revisions WHERE project_id=? LIMIT 1").bind(created.id).first();
    const actualMotors = (await database.prepare("SELECT * FROM npd_project_motors WHERE project_id=? ORDER BY id").bind(created.id).all()).results;
    assert.deepEqual(JSON.parse(baseline.snapshot).data.motors.sort((a, b) => a.id.localeCompare(b.id)), actualMotors.map((row) => ({ ...row })),
      "首次阶段版本应保存建项时的实际电机数据");
  }
  const codePrefix = `NP-${new Date().getFullYear()}-`;
  await database.prepare("UPDATE npd_projects SET code=? WHERE id=?").bind(`${codePrefix}999`, createdPair[0].id).run();
  assert.equal((await store.createNpdProject(createInput, admin)).code, `${codePrefix}1000`);
  assert.equal((await store.createNpdProject(createInput, admin)).code, `${codePrefix}1001`);
  const sharedOrder = await store.createNpdSalesOrder({ orderNo: "SHARED-CREATION-ORDER", customerId: "npd-c-001",
    productSummary: "竞争建项订单", quantity: 2, amount: 100, currency: "CNY", orderDate: "2026-09-06", deliveryDate: "2027-06-01" }, admin);
  const orderClaims = await Promise.allSettled([1, 2].map(() => store.createNpdProject({ ...createInput, orderIds: [sharedOrder.id], orderVersions: { [sharedOrder.id]: 1 } }, admin)));
  assert.equal(orderClaims.filter((result) => result.status === "fulfilled").length, 1, "同一订单只能被一个新项目占用");
  const winnerProject = orderClaims.find((result) => result.status === "fulfilled").value.id;
  assert.equal((await database.prepare("SELECT project_id FROM npd_sales_orders WHERE id=?").bind(sharedOrder.id).first()).project_id, winnerProject);
  const multiOrders = await Promise.all(["ONE", "TWO"].map((suffix) => store.createNpdSalesOrder({ orderNo: `MULTI-${suffix}`,
    customerId: "npd-c-001", productSummary: "一项目多订单", quantity: 1, amount: 100, currency: "CNY",
    orderDate: "2026-09-06", deliveryDate: "2027-06-01" }, admin)));
  const multiProject = await store.createNpdProject({ ...createInput, orderIds: multiOrders.map((order) => order.id), orderVersions: Object.fromEntries(multiOrders.map((order) => [order.id, 1])) }, admin);
  for (const order of multiOrders) {
    assert.equal((await database.prepare("SELECT project_id FROM npd_sales_orders WHERE id=?").bind(order.id).first()).project_id, multiProject.id);
  }
  const wrongCustomer = await store.createNpdSalesOrder({ orderNo: "WRONG-CUSTOMER", customerId: "npd-c-002",
    productSummary: "不可混选客户", quantity: 1, amount: 100, currency: "CNY", orderDate: "2026-09-06", deliveryDate: "2027-06-01" }, admin);
  await assert.rejects(() => store.createNpdProject({ ...createInput, orderIds: [wrongCustomer.id] }, admin), /客户必须与项目客户一致/);
  assert.equal((await database.prepare("SELECT project_id FROM npd_sales_orders WHERE id=?").bind(wrongCustomer.id).first()).project_id, null);
  async function creationState() {
    const rows = {};
    for (const table of ["npd_projects", "npd_project_motors", "npd_project_members", "npd_project_sheets", "npd_sheet_revisions", "npd_sales_orders", "npd_activities"]) {
      rows[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
    }
    return JSON.stringify(rows);
  }
  const rollbackOrder = await store.createNpdSalesOrder({ orderNo: "ROLLBACK-CREATION-ORDER", customerId: "npd-c-001",
    productSummary: "回滚订单", quantity: 1, amount: 100, currency: "CNY", orderDate: "2026-09-06", deliveryDate: "2027-06-01" }, admin);
  const stableCreation = await creationState();
  await assert.rejects(() => store.createNpdProject({ ...createInput, motors: [{ ...addedMotorInput, model: "Model-A" }, { ...addedMotorInput, model: "model-a" }] }, admin), /唯一型号/);
  await assert.rejects(() => store.createNpdProject({ ...createInput, motors: [{ ...addedMotorInput, quantity: 1.5 }] }, admin), /正整数/);
  await database.prepare(`CREATE TRIGGER npd_test_creation_failure BEFORE INSERT ON npd_activities WHEN NEW.action='创建项目'
    BEGIN SELECT RAISE(ABORT,'Injected creation failure'); END`).run();
  try {
    await assert.rejects(() => store.createNpdProject({ ...createInput, orderIds: [rollbackOrder.id], orderVersions: { [rollbackOrder.id]: 1 } }, admin), /Injected creation failure/);
    assert.equal(await creationState(), stableCreation, "建项末步失败必须回滚项目、规格、成员、阶段和版本");
  } finally { await database.prepare("DROP TRIGGER npd_test_creation_failure").run(); }

  const customerInput = { code: "new-customer-001", name: "真实业务入口测试客户", industry: "装备制造", contact: "测试联系人", phone: "010-12345678" };
  const productionUser = workspace.users.find((user) => user.role === "production");
  await assert.rejects(() => store.saveNpdCustomer(customerInput, productionUser), /只有销售和管理员/);
  const customerPair = await Promise.allSettled([1, 2].map(() => store.saveNpdCustomer(customerInput, admin)));
  assert.equal(customerPair.filter((result) => result.status === "fulfilled").length, 1);
  let customer = customerPair.find((result) => result.status === "fulfilled").value;
  assert.equal(customer.code, "NEW-CUSTOMER-001");
  await assert.rejects(() => store.saveNpdCustomer(customerInput, admin), /编号已存在/);
  const customerEdits = await Promise.allSettled(["陈工", "李工"].map((contact) => store.saveNpdCustomer({ ...customer, contact, expected: customer, reason: "联系人交接" }, admin)));
  assert.equal(customerEdits.filter((result) => result.status === "fulfilled").length, 1);
  await assert.rejects(() => store.saveNpdCustomer({ ...customer, phone: "010-00000000", expected: customer, reason: "旧窗口保存" }, admin), { name: "NpdConflictError" });
  customer = customerEdits.find((result) => result.status === "fulfilled").value;
  const customerAuditCount = (await database.prepare("SELECT COUNT(*) AS n FROM npd_activities WHERE entity_type='customer'").first()).n;
  await database.prepare(`CREATE TRIGGER npd_test_customer_failure BEFORE UPDATE ON npd_customers
    BEGIN SELECT RAISE(ABORT,'Injected customer failure'); END`).run();
  try {
    await assert.rejects(() => store.saveNpdCustomer({ ...customer, contact: "失败修改", expected: customer, reason: "故障回滚" }, admin), /Injected customer failure/);
    assert.equal((await database.prepare("SELECT contact FROM npd_customers WHERE id=?").bind(customer.id).first()).contact, customer.contact);
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_activities WHERE entity_type='customer'").first()).n, customerAuditCount);
  } finally { await database.prepare("DROP TRIGGER npd_test_customer_failure").run(); }
  const customerOrder = await store.createNpdSalesOrder({ orderNo: "NEW-CUSTOMER-ORDER", customerId: customer.id,
    productSummary: "新客户订单", quantity: 1, amount: 100, currency: "CNY", orderDate: "2026-09-06", deliveryDate: "2027-06-01" }, admin);
  const customerProject = await store.createNpdProject({ ...createInput, customerId: customer.id, orderIds: [customerOrder.id], orderVersions: { [customerOrder.id]: 1 } }, admin);
  const customerWorkspace = await store.getNpdWorkspaceSnapshot(admin);
  assert.equal(customerWorkspace.projects.find((item) => item.id === customerProject.id).customerName, customer.name);
  assert.equal(customerWorkspace.orders.find((item) => item.id === customerOrder.id).projectId, customerProject.id);

  const orderInput = { orderNo: "ATOMIC-ORDER", customerId: customer.id, productSummary: "订单事务测试",
    quantity: 1, amount: 123.45, currency: "CNY", orderDate: "2026-09-06", deliveryDate: "2027-06-01" };
  const orderCreations = await Promise.allSettled(["atomic-order", "ATOMIC-ORDER"].map((orderNo) => store.createNpdSalesOrder({ ...orderInput, orderNo }, admin)));
  assert.equal(orderCreations.filter((result) => result.status === "fulfilled").length, 1, "并发订单号不区分大小写去重");
  for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(() => store.createNpdSalesOrder({ ...orderInput, orderNo: "INVALID-QTY", quantity }, admin), /正整数/);
  }
  for (const amount of [-1, 1.001, NaN, Infinity]) {
    await assert.rejects(() => store.createNpdSalesOrder({ ...orderInput, orderNo: "INVALID-AMOUNT", amount }, admin), /订单金额/);
  }
  await assert.rejects(() => store.createNpdSalesOrder({ ...orderInput, currency: "BAD" }, admin), /币种/);
  const decimalOrder = await store.createNpdSalesOrder({ ...orderInput, orderNo: "DECIMAL-AMOUNT", amount: 0.1 + 0.2 }, admin);
  assert.equal((await database.prepare("SELECT amount FROM npd_sales_orders WHERE id=?").bind(decimalOrder.id).first()).amount, 0.3);
  const orderAuditCount = (await database.prepare("SELECT COUNT(*) AS n FROM npd_activities WHERE entity_type='sales_order'").first()).n;
  await database.prepare(`CREATE TRIGGER npd_test_order_insert_failure BEFORE INSERT ON npd_sales_orders
    BEGIN SELECT RAISE(ABORT,'Injected order insert failure'); END`).run();
  try {
    await assert.rejects(() => store.createNpdSalesOrder({ ...orderInput, orderNo: "FAILED-ORDER" }, admin), /Injected order insert failure/);
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_sales_orders WHERE order_no='FAILED-ORDER'").first()).n, 0);
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM npd_activities WHERE entity_type='sales_order'").first()).n, orderAuditCount);
  } finally { await database.prepare("DROP TRIGGER npd_test_order_insert_failure").run(); }
  const linkedCustomerOrder = customerWorkspace.orders.find((item) => item.id === customerOrder.id);
  const orderVersion = async (id) => (await database.prepare("SELECT version FROM npd_sales_orders WHERE id=?").bind(id).first()).version;
  const memberBaseline = (userId) => database.prepare("SELECT id,version FROM npd_project_members WHERE project_id=? AND user_id=?").bind(projectId, userId).first();
  await store.linkNpdSalesOrder(customerOrder.id, null, admin, linkedCustomerOrder.projectId, linkedCustomerOrder.version);
  await assert.rejects(() => store.linkNpdSalesOrder(customerOrder.id, customerProject.id, admin, linkedCustomerOrder.projectId, linkedCustomerOrder.version), { name: "NpdConflictError" });
  assert.equal((await database.prepare("SELECT project_id FROM npd_sales_orders WHERE id=?").bind(customerOrder.id).first()).project_id, null);
  await store.linkNpdSalesOrder(customerOrder.id, customerProject.id, admin, null, await orderVersion(customerOrder.id));

  const beforeLifecycle = await businessState();
  const lifecycleVersion = async () => (await database.prepare("SELECT lifecycle_version FROM npd_projects WHERE id=?").bind(projectId).first()).lifecycle_version;
  const initialLifecycleVersion = await lifecycleVersion();
  const detailRevision = await database.prepare("SELECT id FROM npd_sheet_revisions WHERE project_id=? ORDER BY version DESC LIMIT 1").bind(projectId).first();
  const detail = await store.getNpdRevisionDetail(detailRevision.id, admin);
  assert.equal(detail.projectId, projectId);
  assert.ok(Array.isArray(detail.snapshot.data.motors));
  assert.equal(await store.getNpdRevisionDetail("missing-revision", admin), null);
  const outsider = await store.createNpdUser({ email: "revision-outsider@example.test", name: "非项目成员", department: "设计", role: "design", active: true }, admin);
  await assert.rejects(() => store.getNpdRevisionDetail(detailRevision.id, outsider), /只能访问/);
  await assert.rejects(() => store.setNpdProjectStatus(projectId, "invalid", "无效状态", admin, "active"), /状态无效/);
  await assert.rejects(() => store.setNpdProjectStatus(projectId, "paused", "", admin, "active", initialLifecycleVersion), /填写原因/);
  assert.equal(await businessState(), beforeLifecycle);
  await database.prepare(`CREATE TRIGGER npd_test_lifecycle_failure BEFORE UPDATE ON npd_projects
    BEGIN SELECT RAISE(ABORT,'Injected lifecycle failure'); END`).run();
  try {
    await assert.rejects(() => store.setNpdProjectStatus(projectId, "paused", "故障测试", admin, "active", initialLifecycleVersion), /Injected lifecycle failure/);
    assert.equal(await businessState(), beforeLifecycle, "状态更新失败不得留下审计");
  } finally { await database.prepare("DROP TRIGGER npd_test_lifecycle_failure").run(); }
  const pauses = await Promise.allSettled([1, 2].map(() => store.setNpdProjectStatus(projectId, "paused", "等待客户澄清", admin, "active", initialLifecycleVersion)));
  assert.equal(pauses.filter((result) => result.status === "fulfilled").length, 1);
  const pausedState = await businessState();
  const linkedOrder = await database.prepare("SELECT id FROM npd_sales_orders WHERE project_id=? LIMIT 1").bind(projectId).first();
  assert.ok(linkedOrder);
  await assert.rejects(async () => store.linkNpdSalesOrder(linkedOrder.id, null, admin, projectId, await orderVersion(linkedOrder.id)), /项目已暂停/);
  await assert.rejects(() => store.assignProjectMember(projectId, admin.id, "暂停期间新增职责", admin), /项目已暂停/);
  await assert.rejects(() => store.insertNpdDocument(attachment, admin), /项目已暂停/);
  await assert.rejects(() => store.createTestReport({ ...reportInput, reportNo: "PAUSED", documentId: null }, admin), /项目已暂停/);
  await assert.rejects(() => store.addProjectMotor(projectId, { ...addedMotorInput, model: "PAUSED" }, admin), /项目已暂停/);
  await assert.rejects(() => store.setNpdProjectStatus(projectId, "active", "客户已澄清", admin, "active"), { name: "NpdConflictError" });
  assert.equal(await businessState(), pausedState, "暂停与旧页面操作不得写入");
  await store.setNpdProjectStatus(projectId, "active", "客户澄清完成，恢复开发", admin, "paused", await lifecycleVersion());
  assert.equal(await lifecycleVersion(), initialLifecycleVersion + 2);
  const afterResume = await businessState();
  await assert.rejects(() => store.setNpdProjectStatus(projectId, "cancelled", "旧窗口终止", admin, "active", initialLifecycleVersion), { name: "NpdConflictError" });
  await assert.rejects(() => store.setNpdProjectStatus(projectId, "paused", "缺少版本", admin, "active"), { name: "NpdConflictError" });
  assert.equal(await businessState(), afterResume, "暂停后恢复同一状态，旧版/缺版本请求仍须拒绝且零写入");
  const beforeOrderFailure = await businessState();
  await database.prepare(`CREATE TRIGGER npd_test_order_failure BEFORE UPDATE ON npd_sales_orders
    BEGIN SELECT RAISE(ABORT,'Injected order failure'); END`).run();
  try {
    await assert.rejects(async () => store.linkNpdSalesOrder(linkedOrder.id, null, admin, projectId, await orderVersion(linkedOrder.id)), /Injected order failure/);
    assert.equal(await businessState(), beforeOrderFailure, "订单解除失败不得留下审计");
  } finally { await database.prepare("DROP TRIGGER npd_test_order_failure").run(); }
  const initialMemberVersion = await memberBaseline(admin.id);
  const memberWrites = await Promise.allSettled(["统筹设计", "统筹质量"].map((duty) => store.assignProjectMember(projectId, admin.id, duty, admin, initialMemberVersion)));
  assert.equal(memberWrites.filter((result) => result.status === "fulfilled").length, 1);
  const beforeMemberFailure = await businessState();
  await database.prepare(`CREATE TRIGGER npd_test_member_failure BEFORE UPDATE ON npd_project_members
    BEGIN SELECT RAISE(ABORT,'Injected member failure'); END`).run();
  try {
    await assert.rejects(async () => store.assignProjectMember(projectId, admin.id, "不会保存的职责", admin, await memberBaseline(admin.id)), /Injected member failure/);
    assert.equal(await businessState(), beforeMemberFailure, "成员修改失败不得留下审计");
  } finally { await database.prepare("DROP TRIGGER npd_test_member_failure").run(); }
  await store.assignProjectMember(projectId, admin.id, "恢复后统筹交付", admin, await memberBaseline(admin.id));
  const memberAudit = await database.prepare("SELECT detail FROM npd_activities WHERE project_id=? AND action='调整项目成员' ORDER BY rowid DESC LIMIT 1").bind(projectId).first();
  assert.match(memberAudit.detail, /原职责.*现职责/);

  async function accountState() {
    const rows = {};
    for (const table of ["npd_users", "npd_local_sessions", "npd_activities"]) {
      rows[table] = (await database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()).results;
    }
    return JSON.stringify(rows);
  }
  const accountInput = { email: "atomic-admin-a@example.test", name: "事务管理员A", department: "测试", role: "admin", active: true, password: "AccountTest2026" };
  const firstAdmin = await store.createNpdUser(accountInput, admin);
  const secondAdmin = await store.createNpdUser({ ...accountInput, email: "atomic-admin-b@example.test", name: "事务管理员B" }, admin);
  const firstSession = await store.authenticateNpdLocalUser(firstAdmin.email, accountInput.password);
  const oldWindow = (await store.getNpdWorkspaceSnapshot(admin)).users.find((user) => user.id === firstAdmin.id);
  await store.updateNpdUser({ ...oldWindow, userId: oldWindow.id, department: "新管理部门", expected: oldWindow }, admin);
  const savedAccountState = await accountState();
  await assert.rejects(() => store.updateNpdUser({ ...oldWindow, userId: oldWindow.id, name: "旧窗口修改姓名", expected: oldWindow }, admin), { name: "NpdConflictError" });
  assert.equal(await accountState(), savedAccountState, "旧窗口不得覆盖人员资料、权限或改变会话");
  const accountSnapshot = async (id) => (await store.getNpdWorkspaceSnapshot(admin)).users.find((user) => user.id === id);
  const sameBase = await accountSnapshot(firstAdmin.id);
  const duplicateSaves = await Promise.allSettled([1, 2].map(() =>
    store.updateNpdUser({ ...sameBase, userId: sameBase.id, expected: sameBase }, admin)));
  assert.equal(duplicateSaves.filter((result) => result.status === "fulfilled").length, 1, "相同内容同时保存也只能提交一次");
  assert.equal(duplicateSaves.find((result) => result.status === "rejected").reason.name, "NpdConflictError");
  assert.equal((await accountSnapshot(firstAdmin.id)).version, sameBase.version + 1);

  // Restore the timestamp explicitly to model multiple writes within one
  // second. The independent revision, not wall-clock precision, must guard ABA.
  const abaBase = await accountSnapshot(firstAdmin.id);
  await updateUser({ ...abaBase, userId: abaBase.id, department: "临时部门" }, admin);
  await updateUser({ ...abaBase, userId: abaBase.id }, admin);
  await database.prepare("UPDATE npd_users SET updated_at=? WHERE id=?").bind(abaBase.updatedAt, abaBase.id).run();
  assert.equal((await accountSnapshot(firstAdmin.id)).version, abaBase.version + 2);
  const afterAba = await accountState();
  await assert.rejects(() => store.updateNpdUser({ ...abaBase, userId: abaBase.id, name: "旧资料再次覆盖", expected: abaBase }, admin), { name: "NpdConflictError" });
  assert.equal(await accountState(), afterAba, "资料 A→B→A 且时间戳相同，旧窗口仍应零写入");

  const passwordBase = await accountSnapshot(secondAdmin.id);
  const passwordSession = await store.authenticateNpdLocalUser(secondAdmin.email, accountInput.password);
  await store.updateNpdUser({ ...passwordBase, userId: passwordBase.id, expected: passwordBase, password: accountInput.password }, admin);
  await database.prepare("UPDATE npd_users SET updated_at=? WHERE id=?").bind(passwordBase.updatedAt, passwordBase.id).run();
  assert.equal((await accountSnapshot(secondAdmin.id)).version, passwordBase.version + 1);
  assert.equal(await store.resolveNpdLocalSession(passwordSession.token), null);
  const afterPassword = await accountState();
  await assert.rejects(() => store.updateNpdUser({ ...passwordBase, userId: passwordBase.id, name: "密码重置前旧窗口", expected: passwordBase }, admin), { name: "NpdConflictError" });
  const missingVersion = { ...await accountSnapshot(secondAdmin.id) };
  delete missingVersion.version;
  await assert.rejects(() => store.updateNpdUser({ ...passwordBase, userId: passwordBase.id, expected: missingVersion }, admin), { name: "NpdConflictError" });
  assert.equal(await accountState(), afterPassword, "同秒重置密码或遗漏版本的请求不得覆盖账户");
  const passwordAudit = await database.prepare("SELECT detail FROM npd_activities WHERE entity_id=? AND action='更新人员权限' ORDER BY rowid DESC LIMIT 1").bind(secondAdmin.id).first();
  assert.match(passwordAudit.detail, /账户 V\d+ → V\d+.*密码已重置/);
  assert.ok(!passwordAudit.detail.includes(accountInput.password), "审计不得包含密码");
  const beforeAccountFailure = await accountState();
  await database.prepare(`CREATE TRIGGER npd_test_account_failure BEFORE UPDATE ON npd_users
    BEGIN SELECT RAISE(ABORT,'Injected account failure'); END`).run();
  try {
    await assert.rejects(() => updateUser({ ...firstAdmin, userId: firstAdmin.id, role: "sales" }, admin), /Injected account failure/);
    assert.equal(await accountState(), beforeAccountFailure, "账户保存故障不得留下审计或撤销会话");
  } finally { await database.prepare("DROP TRIGGER npd_test_account_failure").run(); }
  assert.equal((await store.resolveNpdLocalSession(firstSession.token)).id, firstAdmin.id);
  await updateUser({ ...admin, userId: admin.id, role: "sales" }, admin);
  const downgrades = await Promise.allSettled([firstAdmin, secondAdmin].map((actor) =>
    updateUser({ ...actor, userId: actor.id, role: "sales" }, actor)));
  assert.equal(downgrades.filter((result) => result.status === "fulfilled").length, 1, "同时降权必须保留一个管理员");
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM npd_users WHERE role='admin' AND active=1").first()).count, 1);
  const surviving = downgrades[0].status === "rejected" ? firstAdmin : secondAdmin;
  const stale = downgrades[0].status === "fulfilled" ? firstAdmin : secondAdmin;
  const stableAccounts = await accountState();
  await assert.rejects(() => store.createNpdUser({ ...accountInput, email: "unauthorized@example.test" }, stale), { name: "NpdConflictError" });
  assert.equal(await accountState(), stableAccounts, "已被降权的管理员不能使用旧身份创建账户");
  if (stale.id === firstAdmin.id) assert.equal(await store.resolveNpdLocalSession(firstSession.token), null);
  const freshSession = await store.authenticateNpdLocalUser(stale.email, accountInput.password);
  await updateUser({ ...stale, userId: stale.id, role: "sales", active: false }, surviving);
  assert.equal(await store.resolveNpdLocalSession(freshSession.token), null, "停用立即撤销旧登录");
  console.log("事务检查通过：阶段/报告、暂停恢复、成员职责和订单关联回滚；账户并发与会话撤销。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkRevisionTransactions(new D1Adapter());
}
