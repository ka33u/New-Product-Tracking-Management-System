import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import JSZip from "jszip";
import { verifyRelease } from "../scripts/local-release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const buildRoot = process.env.NPD_TEST_RELEASE ? (await verifyRelease(process.env.NPD_TEST_RELEASE)).directory : root;
const { startLocalRuntime } = await import(pathToFileURL(path.join(buildRoot, "scripts/local-runtime.mjs")).href);
// The caller cannot choose a state path: this test always owns a fresh directory.
const state = await mkdtemp(path.join(tmpdir(), "hengda-workspace-scale-"));
const runtime = await startLocalRuntime({ buildRoot, state, port: 0 });
try {
  const base = new URL(await runtime.ready).origin;
  const request = (route, options = {}) => fetch(`${base}${route}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(30000) });
  assert.equal((await request("/")).status, 200);
  const setup = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "setup", email: "scale-admin@example.test", name: "规模测试管理员", department: "测试", password: "ScaleOnly2026",
  }) });
  assert.equal(setup.status, 303);
  const cookie = setup.headers.get("set-cookie")?.split(";")[0];
  assert.match(cookie || "", /^npd_local_session=.+/);
  const initial = await (await request("/api/workspace", { headers: { Cookie: cookie } })).json();
  const adminId = initial.currentUser.id;
  const created = await request("/api/action", { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json", "X-NPD-Actor": adminId },
    body: JSON.stringify({ kind: "create_user", payload: { email: "scale-quality@example.test", name: "单项目质量", department: "质量", role: "quality", active: true, password: "ScaleOnly2026" } }) });
  assert.equal(created.status, 200, await created.text());
  const people = (await (await request("/api/workspace", { headers: { Cookie: cookie } })).json()).snapshot.users;
  const qualityId = people.find((user) => user.role === "quality").id;
  const database = await runtime.getD1Database("DB");
  assert.equal((await database.prepare("SELECT COUNT(*) n FROM npd_projects").first()).n, 0, "只允许向空白隔离库准备夹具");
  await database.prepare("INSERT INTO npd_customers(id,code,name,industry) VALUES ('scale-customer','SCALE','隔离规模客户','测试')").run();
  const compiled = ts.transpileModule(await readFile(new URL("../lib/sheets-v2.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { sheetDefinitions } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const historicalPayload = JSON.stringify({ fixture: "完整历史正文<&>😀", padding: "H".repeat(32768) });
  // Sized, referentially valid read fixture. This is not an approval-flow test.
  for (let index = 0; index < 100; index++) {
    const id = `scale-project-${index}`;
    const statements = [database.prepare(`INSERT INTO npd_projects
      (id,code,name,series_name,category,source,customer_id,initiator_id,owner_id,status,current_sheet_code,progress,planned_start,planned_end)
      VALUES (?,?,?,'规模系列','电机','测试','scale-customer',?,?,'active','development_plan',20,'2026-09-01','2027-01-01')`)
      .bind(id, `SCALE-${index}`, `规模测试项目${index}`, adminId, adminId)];
    for (let motor = 0; motor < 10; motor++) statements.push(database.prepare(`INSERT INTO npd_project_motors
      (id,project_id,model,terminal_mode,protection_grade,insulation_class,cooling_method,inspection_requirement,test_requirement,planned_date)
      VALUES (?,?,?,'顶部出线','IP55','F','IC411','全检','温升','2027-01-01')`).bind(`${id}-motor-${motor}`, id, `Y-SCALE-${motor}`));
    for (let part = 0; part < 20; part++) statements.push(database.prepare(`INSERT INTO npd_part_items
      (id,project_id,motor_id,part_no,name,design_output_ref,inspection_requirement,planned_date)
      VALUES (?,?,?,?,?,'R1','尺寸检验','2027-01-01')`).bind(`${id}-part-${part}`, id, `${id}-motor-${Math.floor(part / 2)}`, `PART-${part}`, `零部件${part}`));
    for (let entry = 0; entry < 10; entry++) statements.push(database.prepare(`INSERT INTO npd_activities
      (id,project_id,actor_id,action,entity_type,entity_id,detail,created_at)
      VALUES (?,?,?,'合成规模日志','project',?,'仅供隔离读取验收','2099-01-01 00:00:00')`)
      .bind(`${id}-activity-${entry}`, id, adminId, id));
    sheetDefinitions.forEach((sheet, sheetIndex) => {
      const status = sheetIndex < 2 ? "completed" : "not_started", progress = sheetIndex < 2 ? 100 : 0;
      statements.push(database.prepare(`INSERT INTO npd_project_sheets
        (id,project_id,code,title,sort_order,owner_role,status,progress,planned_date,updated_by)
        VALUES (?,?,?,?,?,?,?,?,'2027-01-01',?)`).bind(`${id}-${sheet.code}`, id, sheet.code, sheet.title, sheet.index, sheet.ownerRole, status, progress, adminId),
      database.prepare(`INSERT INTO npd_sheet_revisions
        (id,project_id,sheet_code,version,action,summary,status,progress,planned_date,actor_id,snapshot)
        VALUES (?,?,?,1,'规模测试','版本摘要',?,?,'2027-01-01',?,?)`).bind(`${id}-revision-${sheet.code}`, id, sheet.code, status, progress, adminId, historicalPayload));
    });
    if (index === 0) statements.push(database.prepare("INSERT INTO npd_project_members(id,project_id,user_id,responsibility) VALUES ('scale-member',?,?,'检验')").bind(id, qualityId));
    await database.batch(statements);
  }
  assert.equal((await database.prepare("PRAGMA foreign_key_check").all()).results.length, 0);
  const stored = await database.prepare("SELECT SUM(length(CAST(snapshot AS BLOB))) bytes FROM npd_sheet_revisions").first();
  const samples = [];
  async function readWorkspace() {
    const start = performance.now();
    const response = await request("/api/workspace", { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    const text = await response.text();
    samples.push({ ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(text) });
    const data = JSON.parse(text).snapshot;
    assert.equal(data.projects.length, 100); assert.equal(data.motors.length, 1000);
    assert.equal(data.parts.length, 2000); assert.equal(data.sheets.length, 1000); assert.equal(data.sheetRevisions.length, 1000);
    assert.ok(data.projects.every((project) => project.motorCount === 10 && project.progress === 20));
    assert.equal(data.activities.length, 300, "管理员工作区保留最近300条摘要");
    assert.ok(data.sheetRevisions.every((revision) => !Object.hasOwn(revision, "snapshot")));
    assert.doesNotMatch(text, /password_hash|password_salt|token_hash/);
  }
  await readWorkspace();
  await Promise.all([1, 2, 3].map(() => readWorkspace()));
  const homeStart = performance.now();
  const home = await request("/", { headers: { Cookie: cookie } });
  assert.equal(home.status, 200);
  const homeBytes = (await home.arrayBuffer()).byteLength;
  const homeMs = Math.round(performance.now() - homeStart);
  const detail = await (await request("/api/revisions/scale-project-0-revision-initiation", { headers: { Cookie: cookie } })).json();
  assert.deepEqual(detail.snapshot, JSON.parse(historicalPayload));
  const exportStart = performance.now();
  const exported = await request("/api/export/project/scale-project-0?format=excel", { headers: { Cookie: cookie } });
  assert.equal(exported.status, 200, exported.status !== 200 ? await exported.text() : "");
  const bytes = await exported.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const decode = (text) => text.replace(/&(lt|gt|quot|apos|amp);/g, (_, entity) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[entity]);
  const strings = [...(await zip.file("xl/sharedStrings.xml").async("string")).matchAll(/<si><t(?:\s[^>]*)?>([\s\S]*?)<\/t><\/si>/g)].map((match) => decode(match[1]));
  const book = await zip.file("xl/workbook.xml").async("string");
  const historyTag = [...book.matchAll(/<sheet\s[^>]+\/>/g)].find((match) => match[0].includes('name="版本数据快照"'))?.[0];
  assert.ok(historyTag);
  const historyId = historyTag.match(/sheetId="(\d+)"/)[1];
  const historyXml = await zip.file(`xl/worksheets/sheet${historyId}.xml`).async("string");
  assert.ok(Buffer.byteLength(historyXml) > 160 * 1024, "回归必须跨过异步 Worker 压缩阈值");
  const reconstructed = new Map();
  for (const [, cellsXml] of historyXml.matchAll(/<row\s[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const [, attributes, value] of cellsXml.matchAll(/<c\s([^>]*)><v>([\s\S]*?)<\/v><\/c>/g)) {
      const column = attributes.match(/r="([A-Z]+)\d+"/)[1];
      cells[column] = /t="s"/.test(attributes) ? strings[Number(value)] : Number(value);
    }
    if (cells.C === "分段序号") continue;
    assert.equal(cells.C, (reconstructed.get(cells.A)?.length || 0) + 1);
    reconstructed.set(cells.A, [...(reconstructed.get(cells.A) || []), cells.E]);
  }
  assert.equal(reconstructed.size, 10);
  for (const chunks of reconstructed.values()) assert.equal(chunks.join(""), historicalPayload, "每个阶段历史正文逐字符还原，不得截断");
  const exportMs = Math.round(performance.now() - exportStart);
  const qualityLogin = await request("/api/local-auth/login", { method: "POST", headers: { Origin: base }, body: new URLSearchParams({
    mode: "login", email: "scale-quality@example.test", password: "ScaleOnly2026",
  }) });
  const qualityCookie = qualityLogin.headers.get("set-cookie")?.split(";")[0];
  assert.match(qualityCookie || "", /^npd_local_session=.+/);
  const restrictedStart = performance.now();
  const restricted = (await (await request("/api/workspace", { headers: { Cookie: qualityCookie } })).json()).snapshot;
  const restrictedMs = Math.round(performance.now() - restrictedStart);
  assert.equal(restricted.projects.length, 1); assert.equal(restricted.motors.length, 10); assert.equal(restricted.parts.length, 20);
  assert.equal(restricted.sheetRevisions.length, 10);
  assert.equal(restricted.activities.filter(item => item.projectId === "scale-project-0").length, 10, "其他99项目的日志不挤占单项目人员的记录");
  assert.ok(restricted.activities.every(item => item.projectId ? item.projectId === "scale-project-0"
    : item.actorId === qualityId || (item.entityType === "user" && item.entityId === qualityId)), "返回日志严格限定可见项目及本人全局记录");
  assert.equal((await request("/api/revisions/scale-project-99-revision-initiation", { headers: { Cookie: qualityCookie } })).status, 403);
  console.log(JSON.stringify({ check: "workspace-scale-http", projects: 100, motors: 1000, parts: 2000, sheets: 1000, historyVersions: 1000,
    storedSnapshotBytes: stored.bytes, sequentialThenThreeConcurrentWorkspaceReads: samples,
    serverRenderedHome: { ms: homeMs, bytes: homeBytes }, projectExcel: { bytes: bytes.byteLength, msIncludingVerification: exportMs },
    fullHistoryDetailAndExportPreserved: true, restrictedMemberProjects: restricted.projects.length,
    projectActivityRows: 1000, restrictedWorkspaceMs: restrictedMs, restrictedProjectActivities: 10,
    scope: "isolated local HTTP/read fixture; not browser timing, capacity guarantee, or long-duration load test" }));
} finally { await runtime.dispose(); }
