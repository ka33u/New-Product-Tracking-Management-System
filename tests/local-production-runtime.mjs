import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import JSZip from "jszip";
import { checkFormReleaseHttp } from "./form-release-http.mjs";

// Only the built application is reused; all business state is isolated here.
const state = await mkdtemp(path.join(tmpdir(), "hengda-production-test-"));
const candidateArgs = process.env.NPD_TEST_RELEASE ? ["--release", process.env.NPD_TEST_RELEASE] : ["--build"];
const child = spawn(process.execPath, ["scripts/local-server.mjs", ...candidateArgs, "--port", "0", "--state", state], {
  detached: process.platform !== "win32", env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(state, "wrangler.log") },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
const completion = once(child, "exit");
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`启动超时：${logs.slice(-3000)}`)), 60000);
    function output(chunk) {
      logs += chunk.toString();
      const match = logs.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    }
    child.stdout.on("data", output); child.stderr.on("data", output);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`服务提前结束 ${code}: ${logs.slice(-3000)}`)); });
  });
  // Synthetic clients explicitly retain the identity shown in their workspace.
  const actorByCookie = new Map();
  const request = async (route, options = {}) => {
    const headers = new Headers(options.headers);
    if (options.method === "POST" && ["/api/action", "/api/files"].includes(route) && !headers.has("X-NPD-Actor")) {
      const actor = actorByCookie.get(headers.get("cookie"));
      if (actor) headers.set("X-NPD-Actor", actor);
    }
    try { return await fetch(`${base}${route}`, { ...options, headers, redirect: "manual", signal: AbortSignal.timeout(15000) }); }
    catch (error) { throw new Error(`${options.method || "GET"} ${route}: ${error.message}; ${error.cause?.code || ""}\n${logs.slice(-1000)}`, { cause: error }); }
  };
  async function taskBadge(cookie) {
    const page = await request("/", { headers: { Cookie: cookie } });
    assert.equal(page.status, 200);
    const match = (await page.text()).match(/<span>我的任务<\/span><em>(\d+)<\/em>/);
    assert.ok(match, "认证首页应显示侧栏待办数量"); return Number(match[1]);
  }
  const initialOriginProbe = await request("/api/action", { method: "POST", headers: { Origin: "null", "Content-Type": "text/plain" }, body: "{}" });
  assert.equal(initialOriginProbe.status, 403, `initial: ${await initialOriginProbe.text()}\n${logs.slice(-900)}`);
  const home = await request("/");
  assert.equal(home.status, 200);
  assert.match(await home.text(), /创建首位管理员/);
  const anonymousWorkspace = await request("/api/workspace");
  assert.equal(anonymousWorkspace.status, 401);
  assert.equal(anonymousWorkspace.headers.get("cache-control"), "no-store");
  assert.equal((await anonymousWorkspace.json()).code, "AUTH_REQUIRED");
  async function assertAuthenticationRequired(cookie) {
    for (const [route, method] of [["/api/action", "POST"], ["/api/files", "POST"],
      ["/api/export/projects", "GET"], ["/api/export/project/missing", "GET"],
      ["/api/files/missing", "GET"], ["/api/revisions/missing", "GET"]]) {
      const response = await request(route, { method, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
        // Invalid bodies must not be parsed before authentication.
        ...(method === "POST" ? { body: "not-a-valid-request" } : {}) });
      assert.equal(response.status, 401, `${method} ${route}: ${response.status}`);
      assert.match(response.headers.get("cache-control") || "", /no-store/);
      assert.equal(response.headers.get("content-disposition"), null);
      const body = await response.json();
      assert.equal(body.code, "AUTH_REQUIRED"); assert.match(body.error, /登录/);
    }
  }
  await assertAuthenticationRequired();
  const assetRoot = process.env.NPD_TEST_RELEASE ? path.join(".local-releases", process.env.NPD_TEST_RELEASE, "dist/client/assets") : "dist/client/assets";
  const assets = await readdir(assetRoot);
  for (const extension of [".js", ".css"]) {
    const asset = assets.find((name) => name.endsWith(extension));
    assert.ok(asset, `构建应包含 ${extension} 静态资源`);
    const response = await request(`/assets/${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), extension === ".js" ? /javascript/ : /css/);
    assert.ok((await response.text()).length > 100);
  }
  const setup = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "setup", email: "runtime-owner@example.test", name: "独立运行时管理员", department: "测试", password: "RuntimeOnly2026",
  }) });
  assert.equal(setup.status, 303);
  assert.equal(new URL(setup.headers.get("location"), base).search, "");
  const cookie = setup.headers.get("set-cookie")?.split(";")[0];
  assert.match(cookie || "", /^npd_local_session=.+/);
  const workspace = await request("/api/workspace", { headers: { Cookie: cookie } });
  assert.equal(workspace.status, 200);
  const data = await workspace.json();
  const snapshot = data.snapshot || data;
  actorByCookie.set(cookie, data.currentUser.id);
  assert.equal(snapshot.users.length, 1);
  assert.equal(snapshot.projects.length, 0);
  const forged = await request("/api/workspace", { headers: { "oai-authenticated-user-id": "fake", "oai-authenticated-user-email": "runtime-owner@example.test" } });
  assert.equal(forged.ok, false, "本地正式构建不得信任伪造的平台身份头");
  assert.equal((await request("/api/local-auth/logout", { headers: { Cookie: cookie } })).status, 405);
  assert.equal((await request("/api/local-auth/logout", { method: "POST", headers: { Cookie: cookie, Origin: "https://example.invalid" } })).status, 403);
  assert.equal((await request("/api/workspace", { headers: { Cookie: cookie } })).status, 200);
  const logout = await request("/api/local-auth/logout", { method: "POST", headers: { Cookie: cookie, Origin: base } });
  assert.equal(logout.status, 303);
  assert.equal(logout.headers.get("cache-control"), "no-store");
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await request("/api/workspace", { headers: { Cookie: cookie } })).ok, false);
  await assertAuthenticationRequired(cookie);
  const wrongPassword = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "login", email: "runtime-owner@example.test", password: "WrongPassword2026",
  }) });
  assert.equal(wrongPassword.status, 303);
  assert.equal(wrongPassword.headers.get("set-cookie"), null);
  assert.ok(new URL(wrongPassword.headers.get("location"), base).searchParams.has("login_error"));
  const login = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "login", email: "runtime-owner@example.test", password: "RuntimeOnly2026",
  }) });
  assert.equal(login.status, 303);
  const loginCookie = login.headers.get("set-cookie")?.split(";")[0];
  actorByCookie.set(loginCookie, data.currentUser.id);
  assert.match(loginCookie || "", /^npd_local_session=.+/);
  assert.equal((await request("/api/workspace", { headers: { Cookie: loginCookie } })).status, 200);
  async function action(kind, payload) {
    const response = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ kind, payload }) });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  const staff = {};
  const noPassword = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({
    kind: "create_user", payload: { email: "unusable@example.test", name: "无密码", department: "测试", role: "design", active: true },
  }) });
  assert.equal(noPassword.status, 400);
  assert.match(await noPassword.text(), /初始密码/);
  const staffCookies = {};
  for (const role of ["sales", "design", "process", "procurement", "production", "tester", "quality"]) {
    await action("create_user", { email: `${role}@example.test`, name: `${role}测试员`, department: "测试", role, active: true, password: "StaffOnly2026" });
    const staffLogin = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
      mode: "login", email: `${role}@example.test`, password: "StaffOnly2026",
    }) });
    assert.equal(staffLogin.status, 303);
    staffCookies[role] = staffLogin.headers.get("set-cookie")?.split(";")[0];
    assert.match(staffCookies[role] || "", /^npd_local_session=.+/);
    const staffWorkspace = await (await request("/api/workspace", { headers: { Cookie: staffCookies[role] } })).json();
    actorByCookie.set(staffCookies[role], staffWorkspace.currentUser.id);
    const denied = await request("/api/action", { method: "POST", headers: { Cookie: staffCookies[role], Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({
      kind: "create_user", payload: { email: "escalation@example.test", name: "越权", department: "测试", role: "admin", active: true, password: "StaffOnly2026" },
    }) });
    assert.equal(denied.status, 403, await denied.text());
  }
  const people = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
  assert.equal((people.snapshot || people).users.length, 8, "无密码和越权创建不得留下账户");
  for (const user of (people.snapshot || people).users) staff[user.role] = user.id;
  assert.equal(people.snapshot.activities.filter(item => item.action === "新建登录账户").length, 7, "管理员保留全部开户日志");
  for (const role of ["sales", "design", "process", "procurement", "production", "tester", "quality"]) {
    const scoped = await (await request("/api/workspace", { headers: { Cookie: staffCookies[role] } })).json();
    assert.ok(scoped.snapshot.activities.some(item => item.action === "新建登录账户" && item.entityId === staff[role]), "本人账户日志可读");
    assert.ok(scoped.snapshot.activities.every(item => !item.projectId && (item.actorId === staff[role]
      || (item.entityType === "user" && item.entityId === staff[role]))), `${role}工作区不得携带其他账户管理日志`);
    assert.ok(!JSON.stringify(scoped.snapshot.activities).includes("runtime-owner@example.test"), "不暴露其他账户的登录邮箱历史；本人日志仍可正常显示管理员操作人姓名");
  }
  console.log("日志访问范围HTTP通过：管理员全局开户审计、七类普通人员仅本人相关全局日志，无其他账户管理记录泄漏。");
  const crossAccountBefore = await (await request("/api/workspace", { headers: { Cookie: staffCookies.sales } })).json();
  const crossAccountPayload = { kind: "save_dashboard_preference", payload: {
    periodMode: "year", periodValue: "2026", customStart: "", customEnd: "", visibleMetrics: ["total"],
  } };
  for (const expectedActor of [staff.admin, ""]) {
    const denied = await request("/api/action", { method: "POST",
      headers: { Cookie: staffCookies.sales, Origin: base, "Content-Type": "application/json", "X-NPD-Actor": expectedActor },
      body: JSON.stringify(crossAccountPayload) });
    assert.equal(denied.status, 409, "旧管理员页面不能使用新销售会话保存，缺少页面身份也不得写入");
    assert.equal((await denied.json()).code, "ACTOR_CONTEXT_CHANGED");
    assert.match(denied.headers.get("cache-control") || "", /no-store/);
  }
  const crossAccountAfter = await (await request("/api/workspace", { headers: { Cookie: staffCookies.sales } })).json();
  assert.deepEqual(crossAccountAfter, crossAccountBefore, "切换账号后的错误提交不得改变数据或成功审计");
  const design = (people.snapshot || people).users.find((user) => user.role === "design");
  async function currentAccount(id) {
    const state = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
    return (state.snapshot || state).users.find((user) => user.id === id);
  }
  await action("update_user", { userId: design.id, expected: design, name: design.name, email: design.email,
    department: design.department, role: design.role, active: true, password: "ChangedOnly2026" });
  const changedDesign = await currentAccount(design.id);
  assert.equal(changedDesign.version, design.version + 1);
  const staleAccount = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({
    kind: "update_user", payload: { ...design, userId: design.id, expected: design, name: "不应覆盖的新姓名" },
  }) });
  assert.equal(staleAccount.status, 409, await staleAccount.text());
  assert.deepEqual(await currentAccount(design.id), changedDesign, "旧窗口提交不得覆盖最新账户");
  assert.equal((await request("/api/workspace", { headers: { Cookie: staffCookies.design } })).ok, false, "重置密码后旧会话必须失效");
  await assertAuthenticationRequired(staffCookies.design);
  const resetLogin = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "login", email: design.email, password: "ChangedOnly2026",
  }) });
  const resetCookie = resetLogin.headers.get("set-cookie")?.split(";")[0];
  assert.match(resetCookie || "", /^npd_local_session=.+/);
  await action("update_user", { userId: design.id, expected: await currentAccount(design.id), name: design.name, email: design.email,
    department: design.department, role: design.role, active: false });
  assert.equal((await request("/api/workspace", { headers: { Cookie: resetCookie } })).ok, false, "停用账户后旧会话必须失效");
  await assertAuthenticationRequired(resetCookie);
  console.log("六类业务入口登录失效HTTP通过：匿名、退出、重置密码和停用均401/no-store，不解析无效写入或生成下载。");
  const disabledLogin = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "login", email: design.email, password: "ChangedOnly2026",
  }) });
  assert.equal(disabledLogin.headers.get("set-cookie"), null);
  assert.ok(new URL(disabledLogin.headers.get("location"), base).searchParams.has("login_error"));
  await action("update_user", { userId: design.id, expected: await currentAccount(design.id), name: design.name, email: design.email,
    department: design.department, role: design.role, active: true });
  console.log("八角色账户回归通过：管理员开户、初始密码必填、普通人员不能开户、密码重置及停用撤销会话。");
  await action("save_customer", { code: "EXPORT-001", name: "导出运行时测试客户", industry: "机械", contact: "", phone: "" });
  const customers = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
  await action("create_project", { name: "导出运行时项目", seriesName: "测试系列", category: "异步电动机", source: "企业研发",
    customerId: (customers.snapshot || customers).customers[0].id, ownerId: staff.design,
    processId: staff.process, procurementId: staff.procurement, productionId: staff.production, testerId: staff.tester, qualityId: staff.quality,
    plannedStart: "2026-09-06", plannedEnd: "2027-03-01", priority: "normal", riskLevel: "medium", description: "隔离测试", orderIds: [],
    motors: [{ model: "Y-EXPORT", ratedPower: "5.5kW", voltage: "380V", frequency: "50Hz", poles: "4", speed: "1450r/min", frameSize: "132", mounting: "B3",
      terminalMode: "顶部出线", protectionGrade: "IP55", insulationClass: "F", coolingMethod: "IC411", quantity: 1,
      inspectionRequirement: "装配全检", testRequirement: "温升", plannedDate: "2027-02-01" }],
  });
  const projects = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
  const projectId = (projects.snapshot || projects).projects[0].id;
  const initialSnapshot = projects.snapshot || projects;
  // Both accounts may write their own preferences, but this page belongs to the
  // other one. Valid same-origin requests must still fail without any writes.
  for (const expectedActor of [staff.sales, ""]) {
    const rejectedWrite = await request("/api/action", { method: "POST",
      headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json", "X-NPD-Actor": expectedActor },
      body: JSON.stringify({ kind: "save_customer", payload: { code: "WRONG-ACTOR", name: "不应创建", industry: "测试" } }) });
    assert.equal(rejectedWrite.status, 409);
    assert.equal((await rejectedWrite.json()).code, "ACTOR_CONTEXT_CHANGED");
    const body = new FormData();
    body.set("projectId", projectId); body.set("sheetCode", "input_output");
    body.set("file", new File(["wrong-actor"], "wrong-actor.txt", { type: "text/plain" }));
    const rejectedFile = await request("/api/files", { method: "POST",
      headers: { Cookie: loginCookie, Origin: base, "X-NPD-Actor": expectedActor }, body });
    assert.equal(rejectedFile.status, 409); assert.equal((await rejectedFile.json()).code, "ACTOR_CONTEXT_CHANGED");
    assert.match(rejectedFile.headers.get("cache-control") || "", /no-store/);
  }
  assert.deepEqual(await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json(), projects);
  // An actor header is not authentication and may never replace the session.
  assert.equal((await request("/api/action", { method: "POST", headers: { Origin: base, "X-NPD-Actor": staff.admin },
    body: JSON.stringify(crossAccountPayload) })).status, 401);
  console.log("跨账号页面HTTP通过：双向账号不一致、缺少页面身份、业务写入和附件均拒绝，数据/审计保持不变，身份头不能替代登录。");
  const dashboardPreference = { periodMode: "custom", periodValue: "2026", customStart: "2026-08-31", customEnd: "2026-09-07", visibleMetrics: ["total", "overdue", "onTime"] };
  for (const payload of [{ ...dashboardPreference, customStart: "2026-09-08" }, { ...dashboardPreference, visibleMetrics: ["total", "total"] }]) {
    const response = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "save_dashboard_preference", payload }) });
    assert.equal(response.status, 400, await response.text());
  }
  const afterInvalidPreferences = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
  assert.equal((afterInvalidPreferences.snapshot || afterInvalidPreferences).activities.length, initialSnapshot.activities.length);
  await action("save_dashboard_preference", dashboardPreference);
  const afterPreferences = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
  assert.deepEqual((afterPreferences.snapshot || afterPreferences).dashboardPreference, dashboardPreference);
  // Later no-write checks compare to the current snapshot, including this legitimate preference audit.
  initialSnapshot.activities = (afterPreferences.snapshot || afterPreferences).activities;
  console.log("看板偏好HTTP验证通过：无效日期/重复指标拒绝且零审计，合法自定义区间保存并重新读取一致。");
  assert.equal(initialSnapshot.projects[0].ownerId, staff.design);
  for (const role of ["process", "procurement"]) {
    assert.ok(initialSnapshot.members.some((member) => member.projectId === projectId && member.role === role && member.userId === staff[role]));
  }
  const motor = initialSnapshot.motors.find((item) => item.projectId === projectId);
  assert.equal(motor.terminalMode, "顶部出线");
  assert.equal(motor.protectionGrade, "IP55");
  assert.equal(motor.insulationClass, "F");
  assert.equal(motor.coolingMethod, "IC411");
  assert.equal(initialSnapshot.sheets.filter((item) => item.projectId === projectId).length, 10);
  assert.equal(initialSnapshot.sheetRevisions.filter((item) => item.projectId === projectId).length, 10);
  assert.equal(await taskBadge(loginCookie), 10);
  assert.equal(await taskBadge(staffCookies.process), 5, "工艺可维护协作阶段应进入待办");
  assert.equal(await taskBadge(staffCookies.procurement), 2, "采购可维护协作阶段应进入待办");
  for (const origin of [undefined, "null", "https://example.invalid", "http://localhost:39999"]) {
    const headers = { Cookie: loginCookie, "Content-Type": "text/plain" };
    if (origin) headers.Origin = origin;
    const rejectedAction = await request("/api/action", { method: "POST", headers, body: JSON.stringify({
      kind: "save_customer", payload: { code: "CSRF-REJECTED", name: "不应写入", industry: "测试", contact: "", phone: "" },
    }) });
    assert.equal(rejectedAction.status, 403, `${origin}: ${await rejectedAction.text()}\n${logs.slice(-1800)}`);
    assert.equal(rejectedAction.headers.get("cache-control"), "no-store", "服务入口应在框架派发前拒绝异常来源");
    const upload = new FormData();
    upload.set("file", new File(["不应上传"], "rejected.txt", { type: "text/plain" }));
    upload.set("projectId", projectId); upload.set("sheetCode", "input_output");
    const uploadHeaders = { Cookie: loginCookie }; if (origin) uploadHeaders.Origin = origin;
    const rejectedUpload = await request("/api/files", { method: "POST", headers: uploadHeaders, body: upload });
    assert.equal(rejectedUpload.status, 403, await rejectedUpload.text());
  }
  assert.equal((await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Sec-Fetch-Site": "cross-site" }, body: "not-json" })).status, 403);
  const unchanged = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
  assert.equal((unchanged.snapshot || unchanged).customers.length, initialSnapshot.customers.length);
  assert.equal((unchanged.snapshot || unchanged).documents.length, initialSnapshot.documents.length);
  assert.equal((unchanged.snapshot || unchanged).activities.length, initialSnapshot.activities.length);
  const upload = new FormData();
  upload.set("file", new File(["同源附件验证\n测试内容"], "inspection-test.txt", { type: "text/plain" }));
  upload.set("projectId", projectId); upload.set("sheetCode", "input_output");
  const uploaded = await request("/api/files", { method: "POST", headers: { Cookie: loginCookie, Origin: base }, body: upload });
  const uploadResult = await uploaded.json();
  assert.equal(uploaded.status, 200, JSON.stringify(uploadResult));
  const file = await request(`/api/files/${uploadResult.id}`, { headers: { Cookie: loginCookie } });
  assert.equal(file.status, 200);
  assert.equal(await file.text(), "同源附件验证\n测试内容");
  assert.match(file.headers.get("content-disposition"), /^attachment/);
  assert.equal((await request(`/api/files/${uploadResult.id}`)).ok, false);
  console.log("跨站写入防护通过：缺失/不同Origin和矛盾Fetch Metadata均拒绝，记录数不变，同源上传与受控下载正常。");
  for (const route of ["/api/export/projects", `/api/export/project/${projectId}?format=excel`]) {
    const downloaded = await request(route, { headers: { Cookie: loginCookie } });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.match(downloaded.headers.get("content-disposition"), /\.xlsx/);
    assert.match(downloaded.headers.get("cache-control"), /no-store/);
    const binary = new Uint8Array(await downloaded.arrayBuffer());
    assert.deepEqual([...binary.slice(0, 4)], [80, 75, 3, 4]);
    assert.ok(binary.length > 1000);
    assert.equal((await request(route)).ok, false, "未登录不得下载数据");
  }
  console.log("正式构建XLSX下载通过：独立空库建员/建客/建项目、概览和项目二进制文件、正确扩展名和鉴权。");
  for (const format of ["archive", "sheet&sheet=input_output"]) {
    const route = `/api/export/project/${projectId}?format=${format}`;
    const downloaded = await request(route, { headers: { Cookie: loginCookie } });
    if (downloaded.status !== 200) assert.fail(`Word导出失败 ${downloaded.status}: ${await downloaded.text()}`);
    assert.equal(downloaded.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.match(downloaded.headers.get("content-disposition"), /\.docx/);
    assert.match(downloaded.headers.get("cache-control"), /no-store/);
    assert.equal(downloaded.headers.get("x-content-type-options"), "nosniff");
    const bytes = new Uint8Array(await downloaded.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 4)], [80, 75, 3, 4]);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml").async("string");
    assert.ok(xml.includes("导出运行时项目"));
    for (const text of ["出线形式", "防护等级", "绝缘等级", "冷却方式", "顶部出线", "IP55", "IC411", "inspection-test.txt"]) assert.ok(xml.includes(text), text);
    assert.ok(xml.includes("版本与修改记录"));
    assert.ok(xml.includes("独立运行时管理员"));
    assert.equal(xml.includes("HD/JL-SJ-01A1"), format === "archive");
    assert.equal((await request(route)).ok, false, "未登录不得下载Word数据");
    assert.equal((await request(route, { headers: { Cookie: staffCookies.sales } })).status, 403, "非项目成员不得下载Word数据");
  }
  assert.equal((await request(`/api/export/project/${projectId}?format=sheet&sheet=invalid`, { headers: { Cookie: loginCookie } })).status, 400);
  assert.equal((await request(`/api/export/project/${projectId}?format=sheet&sheet=__proto__`, { headers: { Cookie: loginCookie } })).status, 400);
  console.log("正式构建DOCX下载通过：项目/单Sheet原生Word、中文内容与附件索引、正确扩展名/鉴权及非法Sheet拒绝。");
  const bundledBytes = new Map([[uploadResult.id, new TextEncoder().encode("同源附件验证\n测试内容")]]);
  for (const content of ["检验报告第一版\n", "检验报告第二版\n"]) {
    const body = new FormData();
    body.set("file", new File([content], "整机检验报告.txt", { type: "text/plain" }));
    body.set("projectId", projectId); body.set("sheetCode", "quality_inspection"); body.set("motorId", motor.id);
    const response = await request("/api/files", { method: "POST", headers: { Cookie: loginCookie, Origin: base }, body });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    bundledBytes.set(result.id, new TextEncoder().encode(content));
  }
  const bundleRoute = `/api/export/project/${projectId}?format=bundle`;
  const bundleResponse = await request(bundleRoute, { headers: { Cookie: loginCookie } });
  assert.equal(bundleResponse.status, 200, bundleResponse.status !== 200 ? await bundleResponse.text() : "");
  assert.equal(bundleResponse.headers.get("content-type"), "application/zip");
  assert.match(bundleResponse.headers.get("content-disposition"), /\.zip/);
  assert.match(bundleResponse.headers.get("cache-control"), /private, no-store/);
  const bundleBuffer = await bundleResponse.arrayBuffer();
  assert.equal(Number(bundleResponse.headers.get("content-length")), bundleBuffer.byteLength);
  const bundle = await JSZip.loadAsync(bundleBuffer, { checkCRC32: true });
  const manifest = JSON.parse(await bundle.file("04_附件清单.json").async("string"));
  assert.equal(manifest.projectId, projectId); assert.equal(manifest.attachmentCount, 3);
  assert.equal(manifest.stageVersions.length, 10);
  assert.match(manifest.capturedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(manifest.consistency, "d1-single-read-transaction");
  assert.ok(Date.parse(manifest.capturedAt) <= Date.parse(manifest.generatedAt));
  assert.equal(new Set(manifest.attachments.map((item) => item.path)).size, 3);
  for (const attachment of manifest.attachments) {
    assert.deepEqual(await bundle.file(attachment.path).async("uint8array"), bundledBytes.get(attachment.documentId));
    assert.equal(attachment.objectKey, undefined);
  }
  assert.equal(manifest.attachments.filter((item) => item.originalFileName === "整机检验报告.txt").length, 2);
  const bundleWord = await JSZip.loadAsync(await bundle.file("01_开发程序.docx").async("uint8array"), { checkCRC32: true });
  assert.match(await bundleWord.file("word/document.xml").async("string"), /导出运行时项目/);
  const bundleExcel = await JSZip.loadAsync(await bundle.file("02_完整项目数据.xlsx").async("uint8array"), { checkCRC32: true });
  assert.ok(bundleExcel.file("xl/workbook.xml"));
  assert.equal((await request(bundleRoute)).ok, false);
  assert.equal((await request(bundleRoute, { headers: { Cookie: staffCookies.sales } })).status, 403);
  console.log("完整ZIP归档HTTP通过：Word/Excel内部格式、三份原件逐字节一致、中文重名独立保留、长度/CRC和下载权限。");
  async function collaborationSnapshot() {
    const body = await (await request("/api/workspace", { headers: { Cookie: loginCookie } })).json();
    return body.snapshot || body;
  }
  const collaborationBefore = await collaborationSnapshot();
  const oldMember = collaborationBefore.members.find((item) => item.projectId === projectId && item.userId === staff.production);
  assert.equal(oldMember.version, 1);
  await action("assign_member", { projectId, userId: staff.production, responsibility: "生产节点和物料确认", expected: { id: oldMember.id, version: oldMember.version } });
  const staleMember = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({
    kind: "assign_member", payload: { projectId, userId: staff.production, responsibility: "旧窗口内容", expected: { id: oldMember.id, version: 1 } },
  }) });
  assert.equal(staleMember.status, 409);
  const changedMember = (await collaborationSnapshot()).members.find((item) => item.id === oldMember.id);
  assert.equal(changedMember.version, 2); assert.equal(changedMember.responsibility, "生产节点和物料确认");
  await action("create_order", { orderNo: "HTTP-VERSION", customerId: initialSnapshot.projects[0].customerId,
    productSummary: "订单版本核验", quantity: 1, amount: 0, currency: "CNY", orderDate: "2026-09-07", deliveryDate: "2027-01-01" });
  const versionedOrder = (await collaborationSnapshot()).orders.find((item) => item.orderNo === "HTTP-VERSION");
  assert.equal(versionedOrder.version, 1);
  await action("link_order", { orderId: versionedOrder.id, projectId, expectedProjectId: null, expectedVersion: 1 });
  await action("link_order", { orderId: versionedOrder.id, projectId: null, expectedProjectId: projectId, expectedVersion: 2 });
  const beforeStaleOrder = await collaborationSnapshot();
  const staleOrder = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({
    kind: "link_order", payload: { orderId: versionedOrder.id, projectId, expectedProjectId: null, expectedVersion: 1 },
  }) });
  assert.equal(staleOrder.status, 409);
  const afterStaleOrder = await collaborationSnapshot();
  assert.equal(afterStaleOrder.orders.find((item) => item.id === versionedOrder.id).version, 3);
  assert.equal(afterStaleOrder.orders.find((item) => item.id === versionedOrder.id).projectId, null);
  assert.equal(afterStaleOrder.activities.length, beforeStaleOrder.activities.length);
  console.log("协作版本HTTP通过：成员旧窗口409、订单关联后解除再用旧版仍409，数据及失败审计保持不变。");
  const lifecycleBefore = (await collaborationSnapshot()).projects.find((item) => item.id === projectId);
  assert.ok(Number.isSafeInteger(lifecycleBefore.lifecycleVersion));
  await action("set_project_status", { projectId, status: "paused", reason: "客户澄清等待", expectedStatus: lifecycleBefore.status,
    expectedLifecycleVersion: lifecycleBefore.lifecycleVersion });
  const paused = (await collaborationSnapshot()).projects.find((item) => item.id === projectId);
  assert.equal(paused.status, "paused"); assert.equal(paused.lifecycleVersion, lifecycleBefore.lifecycleVersion + 1);
  assert.equal(await taskBadge(loginCookie), 0, "暂停项目不计管理员待办");
  assert.equal(await taskBadge(staffCookies.procurement), 0, "暂停项目不计采购待办");
  await action("set_project_status", { projectId, status: "active", reason: "客户澄清完成", expectedStatus: "paused",
    expectedLifecycleVersion: paused.lifecycleVersion });
  const resumed = await collaborationSnapshot();
  assert.equal(resumed.projects.find((item) => item.id === projectId).lifecycleVersion, lifecycleBefore.lifecycleVersion + 2);
  assert.equal(await taskBadge(loginCookie), 10, "恢复后待办重新出现");
  assert.equal(await taskBadge(staffCookies.procurement), 2);
  for (const expectedLifecycleVersion of [undefined, lifecycleBefore.lifecycleVersion]) {
    const stale = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({
      kind: "set_project_status", payload: { projectId, status: "cancelled", reason: "过期终止决定", expectedStatus: "active", expectedLifecycleVersion },
    }) });
    assert.equal(stale.status, 409, await stale.text());
  }
  const afterStaleLifecycle = await collaborationSnapshot();
  assert.deepEqual(afterStaleLifecycle.projects, resumed.projects);
  assert.deepEqual(afterStaleLifecycle.activities, resumed.activities);
  assert.deepEqual(afterStaleLifecycle.sheetRevisions, resumed.sheetRevisions);
  assert.ok(afterStaleLifecycle.activities.some((item) => /状态版本 V\d+ → V\d+/.test(item.detail)));
  console.log("项目状态HTTP通过：暂停/恢复递增状态版本，旧版和缺版本终止请求409，项目/审计/阶段历史均未变。");
  async function ownerTransferInput(newOwnerId) {
    const data = await collaborationSnapshot();
    const project = data.projects.find((item) => item.id === projectId);
    return { projectId, newOwnerId, expectedOwnerId: project.ownerId, expectedOwnershipVersion: project.ownershipVersion,
      expectedLifecycleVersion: project.lifecycleVersion, reason: "HTTP人员交接核验", previousOwnerResponsibility: "设计咨询与交接协作",
      newOwnerResponsibility: "项目全流程负责人", expectedMembers: Object.fromEntries([project.ownerId, newOwnerId].map((userId) => {
        const member = data.members.find((item) => item.projectId === projectId && item.userId === userId);
        return [userId, member ? { id: member.id, version: member.version } : null];
      })) };
  }
  const transferBefore = await collaborationSnapshot();
  const transferInput = await ownerTransferInput(staff.sales);
  const deniedTransfer = await request("/api/action", { method: "POST", headers: { Cookie: staffCookies.production, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "transfer_project_owner", payload: transferInput }) });
  assert.equal(deniedTransfer.status, 403, await deniedTransfer.text());
  await action("transfer_project_owner", transferInput);
  const transferred = await collaborationSnapshot();
  const newProjectOwner = transferred.projects.find((item) => item.id === projectId);
  assert.equal(newProjectOwner.ownerId, staff.sales);
  assert.equal(newProjectOwner.ownershipVersion, transferInput.expectedOwnershipVersion + 1);
  assert.equal(newProjectOwner.initiatorId, initialSnapshot.projects[0].initiatorId);
  assert.equal(newProjectOwner.ownerName, transferred.users.find((item) => item.id === staff.sales).name);
  assert.deepEqual(transferred.sheetRevisions, transferBefore.sheetRevisions);
  const newOwnerWorkspace = await (await request("/api/workspace", { headers: { Cookie: staffCookies.sales } })).json();
  assert.ok((newOwnerWorkspace.snapshot || newOwnerWorkspace).projects.some((item) => item.id === projectId));
  const handedArchive = await request(`/api/export/project/${projectId}?format=excel`, { headers: { Cookie: staffCookies.sales } });
  assert.equal(handedArchive.status, 200); await handedArchive.arrayBuffer();
  const returnInput = await ownerTransferInput(staff.design);
  const returned = await request("/api/action", { method: "POST", headers: { Cookie: staffCookies.sales, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "transfer_project_owner", payload: returnInput }) });
  assert.equal(returned.status, 200, await returned.text());
  const returnedSnapshot = await collaborationSnapshot();
  const staleTransfer = await request("/api/action", { method: "POST", headers: { Cookie: loginCookie, Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "transfer_project_owner", payload: transferInput }) });
  assert.equal(staleTransfer.status, 409, await staleTransfer.text());
  const afterStaleTransfer = await collaborationSnapshot();
  assert.deepEqual(afterStaleTransfer.activities, returnedSnapshot.activities);
  assert.deepEqual(afterStaleTransfer.members, returnedSnapshot.members);
  assert.deepEqual(afterStaleTransfer.projects, returnedSnapshot.projects);
  assert.equal(afterStaleTransfer.projects.find((item) => item.id === projectId).ownershipVersion, transferInput.expectedOwnershipVersion + 2);
  console.log("负责人交接HTTP通过：普通成员403、新负责人立即可访问归档并交接、原发起人及阶段历史不变、往返交接后旧版409且零写入。");
  // Actual account/member writes and authenticated SSR, not browser interaction.
  const staffingBefore = await collaborationSnapshot();
  const revisionId = staffingBefore.sheetRevisions.find((item) => item.projectId === projectId).id;
  const historicalBefore = (await (await request(`/api/revisions/${revisionId}`, { headers: { Cookie: loginCookie } })).json()).snapshot;
  await action("create_user", { email: "second-sales@example.test", name: "协同销售乙", department: "销售", role: "sales", active: true, password: "StaffOnly2026" });
  const secondSales = (await collaborationSnapshot()).users.find((item) => item.email === "second-sales@example.test");
  await action("assign_member", { projectId, userId: secondSales.id, responsibility: "立项协作", expected: null });
  async function stageText() {
    const page = await request("/", { headers: { Cookie: loginCookie } });
    assert.equal(page.status, 200);
    const label = (await page.text()).match(/class="npd2-stage"><span><b>[^<]*<\/b><em>([\s\S]*?)<\/em>/)?.[1];
    assert.ok(label, "认证首页必须呈现当前阶段及责任人"); return label;
  }
  assert.match(await stageText(), /sales测试员、协同销售乙/);
  for (const id of [staff.sales, secondSales.id]) {
    const expected = await currentAccount(id);
    await action("update_user", { ...expected, userId: id, expected, active: false });
  }
  const unstaffed = await stageText();
  assert.match(unstaffed, /sales测试员（账号已停用）/); assert.match(unstaffed, /协同销售乙（账号已停用）/); assert.match(unstaffed, /销售待分配/);
  const reenabled = await currentAccount(secondSales.id);
  await action("update_user", { ...reenabled, userId: reenabled.id, expected: reenabled, active: true, name: "重新到岗销售" });
  const restaffed = await stageText(); assert.match(restaffed, /重新到岗销售/); assert.doesNotMatch(restaffed, /销售待分配|协同销售乙/);
  const revokedWorkspace = await request("/api/workspace", { headers: { Cookie: staffCookies.sales } });
  assert.equal(revokedWorkspace.status, 401, "停用人员仍不能使用旧会话");
  assert.equal(revokedWorkspace.headers.get("cache-control"), "no-store");
  const revokedBody = await revokedWorkspace.json();
  assert.equal(revokedBody.code, "AUTH_REQUIRED"); assert.match(revokedBody.error, /重新登录/); assert.doesNotMatch(revokedBody.error, /初始化/);
  const staffingAfter = await collaborationSnapshot();
  assert.deepEqual(staffingAfter.sheets, staffingBefore.sheets);
  const historicalAfter = (await (await request(`/api/revisions/${revisionId}`, { headers: { Cookie: loginCookie } })).json()).snapshot;
  assert.deepEqual(historicalAfter, historicalBefore, "人员变动不写入或篡改已保存历史快照");
  console.log("节点人员HTTP与服务端渲染通过：同岗位多人、全员停用提示待分配、重新启用/改名同步、旧会话失效及阶段历史原文不变。");
  const closeProject = staffingAfter.projects.find((item) => item.id === projectId);
  await action("set_project_status", { projectId, status: "cancelled", reason: "验证关闭项目退出待办", expectedStatus: closeProject.status,
    expectedLifecycleVersion: closeProject.lifecycleVersion });
  assert.equal(await taskBadge(loginCookie), 0, "终止项目即使管理员可重开也不算待办");
  assert.equal(await taskBadge(staffCookies.procurement), 0);
  assert.deepEqual((await collaborationSnapshot()).sheets, staffingAfter.sheets, "待办分类不改写阶段本身");
  console.log("任务侧栏真实HTTP通过：管理员/工艺/采购归集、暂停归零、恢复回归、终止退出，阶段数据保留。");
  console.log("正式构建本地运行通过：空白初始化、密码登录、会话鉴权、伪造身份拒绝、同源退出和会话撤销。");
  await checkFormReleaseHttp({ request, action, cookie: loginCookie, base, staff,
    customerId: (customers.snapshot || customers).customers[0].id, ownerId: data.currentUser.id });
  for (let attempt = 0; attempt < 10; attempt++) {
    const wrong = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
      mode: "login", email: "absent@example.test", password: "WrongOnly2026",
    }) });
    assert.equal(wrong.status, 303);
    assert.equal(wrong.headers.get("set-cookie"), null);
  }
  for (const accept of ["application/json", "text/html"]) {
    const limited = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base, Accept: accept }, body: new URLSearchParams({
      mode: "login", email: " ABSENT@example.test ", password: "WrongOnly2026",
    }) });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("set-cookie"), null);
    assert.equal(limited.headers.get("cache-control"), "no-store");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    if (accept === "text/html") assert.match(await limited.text(), /返回登录页/);
    else assert.match((await limited.json()).error, /尝试过于频繁/);
  }
  console.log("登录429返回及等待提示通过，继续检查超大请求。");
  const oversized = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "login", email: "large@example.test", password: "a".repeat(9000),
  }) });
  assert.equal(oversized.status, 413);
  await oversized.text();
  assert.equal((await request("/api/workspace", { headers: { Cookie: loginCookie } })).status, 200, "异常登录不得中断已有会话");
  console.log("登录HTTP防护通过：429等待时间、中文返回页/JSON、无会话签发、413超大请求拒绝、现有会话继续工作。");
  // Synthetic credentials in this fresh, isolated server only. A self-update
  // can commit and revoke its own session before the client refresh arrives.
  const selfBefore = await currentAccount(data.currentUser.id);
  await action("update_user", { userId: selfBefore.id, expected: selfBefore, name: "自身修改后已保存", email: selfBefore.email,
    department: selfBefore.department, role: selfBefore.role, active: true, password: "SelfChangedOnly2026" });
  const expiredRefresh = await request("/api/workspace", { headers: { Cookie: loginCookie } });
  assert.equal(expiredRefresh.status, 401); assert.equal((await expiredRefresh.json()).code, "AUTH_REQUIRED");
  await assertAuthenticationRequired(loginCookie);
  const selfLogin = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "login", email: selfBefore.email, password: "SelfChangedOnly2026",
  }) });
  assert.equal(selfLogin.status, 303);
  const selfCookie = selfLogin.headers.get("set-cookie")?.split(";")[0];
  assert.match(selfCookie || "", /^npd_local_session=.+/);
  const selfAfterWorkspace = await (await request("/api/workspace", { headers: { Cookie: selfCookie } })).json();
  const selfAfter = selfAfterWorkspace.snapshot.users.find(user => user.id === selfBefore.id);
  assert.equal(selfAfter.name, "自身修改后已保存"); assert.equal(selfAfter.version, selfBefore.version + 1);
  console.log("自身账户修改HTTP通过：操作200已提交→原会话刷新401→新密码重新登录后姓名和版本准确保留，失效会话不能重复写入。");
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    try { if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  await Promise.race([completion, new Promise((resolve) => setTimeout(resolve, 5000))]);
}
