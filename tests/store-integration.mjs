import assert from "node:assert/strict";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";
import { validFormPayload } from "./form-release.mjs";

const database = new D1Adapter();
// Explicit metadata double for existing index fixtures. Actual D1/R2 release
// behavior is covered by stage-originals-runtime.mjs, not by this double.
const evidenceOriginals = new Map();
const store = await buildStoreModule(database, { FILES: { async head(key) { return evidenceOriginals.get(key) || null; } } });
async function updateUser(input, actor) {
  const expected = (await store.getNpdWorkspaceSnapshot(actor)).users.find((user) => user.id === input.userId);
  return store.updateNpdUser({ ...input, expected }, actor);
}
await store.ensureNpdDatabase();

// Two tabs submitting first setup must not overwrite each other's password.
const setupDatabase = new D1Adapter();
const setupStore = await buildStoreModule(setupDatabase);
await setupStore.ensureNpdDatabase();
const setupResults = await Promise.allSettled(["FirstAdmin2026", "SecondAdmin2026"].map((password) =>
  setupStore.setupNpdLocalAdmin({ email: "initial@example.com", name: "初始化管理员", department: "管理", password })));
assert.equal(setupResults.filter((item) => item.status === "fulfilled").length, 1);
const winner = setupResults.findIndex((item) => item.status === "fulfilled");
await setupStore.authenticateNpdLocalUser("initial@example.com", ["FirstAdmin2026", "SecondAdmin2026"][winner]);
setupDatabase.database.prepare("UPDATE npd_users SET password_hash=NULL,password_salt=NULL").run();
assert.equal((await setupStore.getNpdLocalAuthState()).configured, true);
await assert.rejects(() => setupStore.setupNpdLocalAdmin({ email: "takeover@example.com", name: "非法重建", department: "管理", password: "Takeover2026" }), /已初始化/);

const admin = await store.resolveNpdCurrentUser(null, null);
const sales = await store.resolveNpdCurrentUser("sales@hengda-motor.local", "徐杰");
const design = await store.resolveNpdCurrentUser("design@hengda-motor.local", "王琳");
const processUser = await store.resolveNpdCurrentUser("process@hengda-motor.local", "张伟");
const procurement = await store.resolveNpdCurrentUser("procurement@hengda-motor.local", "孙悦");
const production = await store.resolveNpdCurrentUser("production@hengda-motor.local", "吴军");
const tester = await store.resolveNpdCurrentUser("tester@hengda-motor.local", "赵敏");
const quality = await store.resolveNpdCurrentUser("quality@hengda-motor.local", "周宁");
assert.deepEqual([admin.role, sales.role, design.role, processUser.role, procurement.role, production.role, tester.role, quality.role], ["admin", "sales", "design", "process", "procurement", "production", "tester", "quality"]);
assert.equal((await store.getNpdLocalAuthState()).configured, false);
const localAdminSession = await store.setupNpdLocalAdmin({
  email: admin.email, name: admin.name, department: admin.department, password: "AdminTest2026",
});
assert.equal(localAdminSession.user.role, "admin");
assert.equal((await store.resolveNpdLocalSession(localAdminSession.token)).id, admin.id);
await store.endNpdLocalSession(localAdminSession.token);
assert.equal(await store.resolveNpdLocalSession(localAdminSession.token), null);

let snapshot = await store.getNpdWorkspaceSnapshot(admin);
assert.equal(snapshot.projects.length, 4);
assert.equal(snapshot.users.length, 8);
assert.equal(snapshot.orders.length, 5);
assert.equal(snapshot.motors.length, 7);
assert.equal(snapshot.sheets.length, 40);
assert.equal(snapshot.sheets.filter((sheet) => sheet.projectId === "npd-p-001").length, 10);

await assert.rejects(() => store.createNpdUser({
  email: "new.designer@hengda-motor.local", name: "新设计员", department: "技术部",
  role: "design", active: true,
}, production), /只有管理员/);
const newUser = await store.createNpdUser({
  email: "new.designer@hengda-motor.local", name: "新设计员", department: "技术部·设计科",
  role: "design", active: true, password: "Designer2026",
}, admin);
assert.equal((await store.resolveNpdCurrentUser(newUser.email, newUser.name)).id, newUser.id);
const designerSession = await store.authenticateNpdLocalUser(newUser.email, "Designer2026");
assert.equal(designerSession.user.id, newUser.id);
await updateUser({ userId: newUser.id, email: newUser.email, name: newUser.name,
  department: newUser.department, role: "design", active: true, password: "ResetDesigner2026" }, admin);
assert.equal(await store.resolveNpdLocalSession(designerSession.token), null);
await assert.rejects(() => store.authenticateNpdLocalUser(newUser.email, "Designer2026"), /邮箱或密码/);
assert.equal((await store.authenticateNpdLocalUser(newUser.email, "ResetDesigner2026")).user.id, newUser.id);
await assert.rejects(() => store.createNpdUser({
  email: "NEW.DESIGNER@hengda-motor.local", name: "重复账户", department: "技术部",
  role: "design", active: true,
}, admin), /登录邮箱已存在/);
await updateUser({
  userId: newUser.id, email: "designer2@hengda-motor.local", name: "陈工",
  department: "技术部·设计二科", role: "design", active: true,
}, admin);
snapshot = await store.getNpdWorkspaceSnapshot(admin);
assert.equal(snapshot.users.find((user) => user.id === newUser.id).name, "陈工");
await updateUser({
  userId: newUser.id, email: "designer2@hengda-motor.local", name: "陈工",
  department: "技术部·设计二科", role: "design", active: false,
}, admin);
await assert.rejects(
  () => store.resolveNpdCurrentUser("designer2@hengda-motor.local", "陈工"),
  /账号已停用/,
);
await assert.rejects(() => updateUser({
  userId: admin.id, email: admin.email, name: admin.name, department: admin.department,
  role: "sales", active: true,
}, admin), /至少一名有效管理员/);

await assert.rejects(() => store.createNpdProject({}, production), /只有销售、设计和管理员/);
await assert.rejects(() => store.createNpdSalesOrder({}, production), /只有销售或管理员/);
const order = await store.createNpdSalesOrder({
  orderNo: "SO-TEST-2026-001", customerId: "npd-c-001",
  productSummary: "YBX5-160M/180M 集成测试订单", quantity: 3, amount: 528000,
  currency: "CNY", orderDate: "2026-08-29", deliveryDate: "2027-03-10",
}, sales);
const created = await store.createNpdProject({
  name: "集成测试防爆电机系列", seriesName: "YBX5 测试系列", category: "全新产品", source: "客户订单",
  customerId: "npd-c-001", ownerId: sales.id, processId: processUser.id,
  procurementId: procurement.id, productionId: production.id, testerId: tester.id,
  qualityId: quality.id, plannedStart: "2026-08-29", plannedEnd: "2027-02-28", priority: "high",
  riskLevel: "medium", description: "验证多规格、分权、阶段门、试验、质量和导出数据链。", orderIds: [order.id], orderVersions: { [order.id]: 1 },
  motors: [
    { model: "YBX5-160M-4", ratedPower: "11kW", voltage: "380V", frequency: "50Hz", poles: "4", speed: "1460r/min", frameSize: "160M", mounting: "B3", terminalMode: "顶部出线", protectionGrade: "IP55", insulationClass: "F级", coolingMethod: "IC411", quantity: 2, inspectionRequirement: "隔爆面、效率、温升、振动及装配尺寸全检", testRequirement: "效率、温升、堵转、隔爆结构验证", plannedDate: "2027-01-20" },
    { model: "YBX5-180M-4", ratedPower: "18.5kW", voltage: "380V", frequency: "50Hz", poles: "4", speed: "1470r/min", frameSize: "180M", mounting: "B3", terminalMode: "右侧出线", protectionGrade: "IP56", insulationClass: "F级", coolingMethod: "IC411", quantity: 1, inspectionRequirement: "隔爆面、效率、温升、振动及装配尺寸全检", testRequirement: "效率、温升、堵转、隔爆结构验证", plannedDate: "2027-02-02" },
  ],
}, sales);

snapshot = await store.getNpdWorkspaceSnapshot(admin);
assert.equal(snapshot.projects.length, 5);
assert.equal(snapshot.orders.find((item) => item.id === order.id).projectId, created.id);
assert.equal(snapshot.motors.filter((motor) => motor.projectId === created.id).length, 2);
assert.equal(snapshot.sheets.filter((sheet) => sheet.projectId === created.id).length, 10);
assert.equal(snapshot.members.filter((member) => member.projectId === created.id).length, 6);
assert.ok((await store.getNpdWorkspaceSnapshot(quality)).projects.some((project) => project.id === created.id));
assert.ok(!(await store.getNpdWorkspaceSnapshot(design)).projects.some((project) => project.id === created.id));
await store.assignProjectMember(created.id, design.id, "设计输出、图纸与检验试验要求维护", sales, null);

await assert.rejects(() => store.saveNpdFormRecord(created.id, "HD/JL-SJ-01A1", { source: "客户" }, true, sales, "", 0), /提交前请完成/);
await store.saveNpdFormRecord(created.id, "HD/JL-SJ-01A1", {
  source: "客户", productName: "集成测试防爆电机系列", productModel: "YBX5-160M-4 / YBX5-180M-4",
  initiationDate: "2026-08-29", requiredDate: "2027-02-28", functionSummary: "隔爆高效驱动",
  performance: "满足技术协议和能效要求", innovation: "隔爆结构与高效电磁方案平台化",
}, true, sales, "", 0);
snapshot = await store.getNpdWorkspaceSnapshot(sales);
const initiation = snapshot.sheets.find((sheet) => sheet.projectId === created.id && sheet.code === "initiation");
await store.updateProjectSheet(created.id, "initiation", { status: "completed", progress: 100, plannedDate: initiation.plannedDate, note: "立项资料齐套。", changeReason: "立项评审通过", expectedVersion: initiation.version }, sales);
const inputOutput = (await store.getNpdWorkspaceSnapshot(sales)).sheets.find((sheet) => sheet.projectId === created.id && sheet.code === "input_output");
await assert.rejects(() => store.updateProjectSheet(created.id, "input_output", { status: "completed", progress: 100, plannedDate: inputOutput.plannedDate, note: "尝试绕过输入输出表单。", changeReason: "测试阶段门", expectedVersion: inputOutput.version }, sales), /受控表单尚未提交/);

await store.addPartItem({ projectId: created.id, motorId: null, partNo: "YBX5-FAN", name: "低噪声风扇", specification: "160-180 通用", material: "PA66-GF30", quantity: 2, sourceType: "外购", designOutputRef: "DO-YBX5-COM-04", inspectionRequirement: "外观、关键尺寸、材质证明全检", testRequirement: "1.2 倍超速 2min", plannedDate: "2026-12-20" }, design);
snapshot = await store.getNpdWorkspaceSnapshot(admin);
const part = snapshot.parts.find((item) => item.projectId === created.id);
await assert.rejects(() => store.confirmPartItem(part.id, "completed", "越权确认", sales, part.designRevision, sheetVersion("parts_plan")), /只有生产或管理员/);
await store.confirmPartItem(part.id, "completed", "物料检验合格并完成入库。", production, part.designRevision, sheetVersion("parts_plan"));

const motor = snapshot.motors.find((item) => item.projectId === created.id);
await assert.rejects(() => store.updateMotorRequirements(motor.id, "新检验要求", "新试验要求", production, motor.designRevision), /只有设计/);
await assert.rejects(() => store.createTestReport({ projectId: created.id, expectedRevision: motor.designRevision, motorId: motor.id, reportNo: "TR-TEST-001", reportType: "型式试验", title: "越权报告", requirementRef: motor.testRequirement, testDate: "2026-12-30", result: "合格", conclusion: "", documentId: null }, production), /只有试验员/);
await store.createTestReport({ projectId: created.id, expectedRevision: motor.designRevision, motorId: motor.id, reportNo: "TR-TEST-001", reportType: "型式试验", title: `${motor.model} 型式试验报告`, requirementRef: motor.testRequirement, testDate: "2026-12-30", result: "合格", conclusion: "测试指标满足设计要求。", documentId: null }, tester);
await store.createInspectionRecord({ projectId: created.id, expectedRevision: motor.designRevision, itemType: "motor", motorId: motor.id, partItemId: null, inspectionDate: "2026-12-29", result: "合格", conclusion: "整机检验合格。", documentId: null }, quality);

snapshot = await store.getNpdWorkspaceSnapshot(admin);
const inspection = snapshot.inspections.find((item) => item.projectId === created.id && item.motorId === motor.id);
assert.equal(inspection.inspectionRequirement, motor.inspectionRequirement);
assert.match(inspection.designOutputRef, new RegExp(motor.model));
assert.ok(snapshot.activities.filter((item) => item.projectId === created.id).length >= 7);
const archive = await store.getNpdProjectArchiveData(created.id, admin);
assert.equal(archive.motors.length, 2);
assert.equal(archive.parts.length, 1);
assert.equal(archive.tests.length, 1);
assert.equal(archive.inspections.length, 1);
assert.ok(archive.revisions.length >= 10);

// A downstream released stage must be reopened, without losing its old evidence.
database.database.prepare("UPDATE npd_project_sheets SET status='completed',progress=100 WHERE project_id=? AND code='verification'").run(created.id);
await store.updateProjectMotor(motor.id, {
  model: motor.model, ratedPower: motor.ratedPower, voltage: motor.voltage,
  frequency: motor.frequency, poles: motor.poles, speed: motor.speed,
  frameSize: motor.frameSize, mounting: motor.mounting, terminalMode: "左侧出线",
  protectionGrade: "IP56", insulationClass: motor.insulationClass,
  coolingMethod: motor.coolingMethod, quantity: motor.quantity,
  inspectionRequirement: `${motor.inspectionRequirement}；新增出线方向检查`,
  testRequirement: motor.testRequirement, plannedDate: motor.plannedDate,
  changeReason: "客户要求调整出线方向和防护等级",
  expectedRevision: motor.designRevision,
}, design);
snapshot = await store.getNpdWorkspaceSnapshot(admin);
const revisedMotor = snapshot.motors.find((item) => item.id === motor.id);
assert.equal(revisedMotor.designRevision, 2);
assert.equal(revisedMotor.terminalMode, "左侧出线");
assert.ok(snapshot.sheetRevisions.some((item) => item.projectId === created.id && item.action === "变更电机规格"));
assert.equal(snapshot.sheets.find((item) => item.projectId === created.id && item.code === "verification").status, "pending_review");
const evidence = database.database.prepare("SELECT snapshot FROM npd_sheet_revisions WHERE project_id=? AND action='变更电机规格'").get(created.id);
assert.equal(JSON.parse(evidence.snapshot).data.motors.find((item) => item.id === motor.id).terminal_mode, "左侧出线");
// Restart-time demo repairs must never assign demo users to real projects.
database.database.prepare("DELETE FROM npd_project_members WHERE project_id=? AND user_id=?").run(created.id, processUser.id);
const restartedStore = await buildStoreModule(database);
await restartedStore.ensureNpdDatabase();
assert.equal(database.database.prepare("SELECT count(*) AS n FROM npd_project_members WHERE project_id=? AND user_id=?").get(created.id, processUser.id).n, 0);

// Evidence gates: same-second re-tests, cross-category failures, attachments,
// and current design requirements must agree with the progress calculation.
function evidenceDocument(id, stage) {
  const key = `npd/${created.id}/${stage}/${id}`;
  evidenceOriginals.set(key, { key, size: 10, etag: `fixture-${id}` });
  database.database.prepare(`INSERT INTO npd_documents
    (id,project_id,sheet_code,file_name,object_key,content_type,size,uploaded_by)
    VALUES (?,?,?,? ,?,'application/pdf',10,?)`).run(id, created.id, stage, `${id}.pdf`, key, admin.id);
  return id;
}
let reportSequence = 0;
async function evidenceReport(target, type, result, withFile = true) {
  const no = `EVIDENCE-${++reportSequence}`;
  return store.createTestReport({ projectId: created.id, expectedRevision: target.designRevision, motorId: target.id,
    reportNo: no, reportType: type, title: no, requirementRef: target.testRequirement,
    testDate: "2027-01-01", result, conclusion: "测试证据",
    documentId: withFile ? evidenceDocument(no, "verification") : null }, tester);
}
const evidenceMotors = (await store.getNpdWorkspaceSnapshot(admin)).motors.filter((item) => item.projectId === created.id);
await evidenceReport(evidenceMotors[0], "型式试验", "不合格");
await evidenceReport(evidenceMotors[0], "性能试验", "合格");
await evidenceReport(evidenceMotors[1], "型式试验", "合格");
database.database.prepare("UPDATE npd_project_sheets SET status='completed' WHERE project_id=? AND sort_order<6").run(created.id);
database.database.prepare(`INSERT INTO npd_form_records (id,project_id,form_code,sheet_code,status,payload,updated_by)
  VALUES ('evidence-verification-form',?,'HD/JL-SJ-06A1','verification','submitted',?,?)`).run(created.id, JSON.stringify(validFormPayload("HD/JL-SJ-06A1")), admin.id);
async function releaseVerification() {
  return store.updateProjectSheet(created.id, "verification", { status: "completed", progress: 100,
    plannedDate: "2027-01-20", note: "证据齐套复核", changeReason: "测试放行条件", expectedVersion: sheetVersion("verification") }, admin);
}
function sheetVersion(code) { return database.database.prepare("SELECT version FROM npd_project_sheets WHERE project_id=? AND code=?").get(created.id, code).version; }
assert.equal((await store.getNpdWorkspaceSnapshot(admin)).sheets.find((item) => item.projectId === created.id && item.code === "verification").progress, 45);
await assert.rejects(releaseVerification, /型式试验不合格/);
await evidenceReport(evidenceMotors[0], "型式试验", "合格", false);
await assert.rejects(releaseVerification, /缺少报告附件/);
await evidenceReport(evidenceMotors[0], "型式试验", "合格");
assert.equal((await store.getNpdWorkspaceSnapshot(admin)).sheets.find((item) => item.projectId === created.id && item.code === "verification").progress, 90);
await releaseVerification();
assert.equal((await store.getNpdWorkspaceSnapshot(admin)).sheets.find((item) => item.projectId === created.id && item.code === "verification").status, "completed");

async function inspectEvidence(type, target, result, withFile = true) {
  const no = `INSPECTION-${++reportSequence}`;
  return store.createInspectionRecord({ projectId: created.id, expectedRevision: target.designRevision, itemType: type,
    motorId: type === "motor" ? target.id : null, partItemId: type === "part" ? target.id : null,
    inspectionDate: "2027-01-01", result, conclusion: "测试处置依据",
    documentId: withFile ? evidenceDocument(no, "quality_inspection") : null }, quality);
}
const releaseQuality = () => store.updateProjectSheet(created.id, "quality_inspection", {
  status: "completed", progress: 100, plannedDate: "2027-02-01", note: "质量复核", changeReason: "测试质量放行",
  expectedVersion: sheetVersion("quality_inspection"),
}, admin);
await inspectEvidence("motor", evidenceMotors[0], "合格");
await inspectEvidence("motor", evidenceMotors[1], "合格");
await inspectEvidence("part", part, "不合格");
await assert.rejects(releaseQuality, /最新检验结论不合格/);
await inspectEvidence("part", part, "合格", false);
await assert.rejects(releaseQuality, /缺少检验附件/);
await inspectEvidence("part", part, "合格");
await releaseQuality();
assert.equal((await store.getNpdWorkspaceSnapshot(admin)).sheets.find((item) => item.projectId === created.id && item.code === "quality_inspection").status, "completed");
await assert.rejects(() => store.createInspectionRecord({ projectId: created.id, expectedRevision: evidenceMotors[0].designRevision,
  itemType: "motor", motorId: evidenceMotors[0].id, partItemId: part.id,
  inspectionDate: "2027-01-01", result: "合格", conclusion: "", documentId: null }, quality), /只能关联一个/);
await assert.rejects(() => store.createTestReport({ projectId: created.id, expectedRevision: evidenceMotors[0].designRevision, motorId: evidenceMotors[0].id,
  reportNo: "INVALID-REF", reportType: "型式试验", title: "错误引用", requirementRef: "随意填写的要求",
  testDate: "2027-01-01", result: "合格", conclusion: "", documentId: null }, tester), /当前设计输出一致/);

const ownerDatabase = new D1Adapter();
const ownerStore = await buildStoreModule(ownerDatabase, { NPD_OWNER_EMAIL: "owner@example.com" });
await ownerStore.ensureNpdDatabase();
await ownerStore.resolveNpdCurrentUser("first-visitor@example.com", "首个访问者");
const configuredOwner = await ownerStore.resolveNpdCurrentUser("OWNER@EXAMPLE.COM", "站点所有者");
assert.equal(configuredOwner.role, "admin");
assert.equal(configuredOwner.active, true);
await assert.rejects(
  () => ownerStore.resolveNpdCurrentUser("not-opened@example.com", "未开通人员"),
  /账号尚未开通/,
);

console.log("V2 store integration OK:", `${snapshot.projects.length} projects,`, `${snapshot.motors.length} motors,`, `${snapshot.activities.length} timestamped events`);
