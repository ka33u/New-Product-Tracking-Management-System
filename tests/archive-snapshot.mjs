import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";

export async function checkArchiveSnapshot(database = new D1Adapter()) {
  const sqlByStatement = new WeakMap();
  let guarded = false;
  let batches = [];
  let beforeRead = null;
  let afterRead = null;
  function wrap(statement, sql) {
    const proxy = {
      bind(...values) { return wrap(statement.bind(...values), sql); },
      first(...args) { assert.equal(guarded, false, "归档不得分开读取 first"); return statement.first(...args); },
      all(...args) { assert.equal(guarded, false, "归档不得分开读取 all"); return statement.all(...args); },
      run(...args) { assert.equal(guarded, false, "归档不得写入"); return statement.run(...args); },
    };
    sqlByStatement.set(proxy, { statement, sql });
    return proxy;
  }
  const instrumented = {
    prepare(sql) { return wrap(database.prepare(sql), sql); },
    async batch(statements) {
      const unwrapped = statements.map((stmt) => sqlByStatement.get(stmt));
      if (guarded) {
        batches.push(unwrapped.map((item) => item.sql));
        assert.ok(unwrapped.every((item) => /^(WITH archive_project|SELECT)\b/.test(item.sql)), "归档必须只读");
        if (beforeRead) { const action = beforeRead; beforeRead = null; await action(); }
      }
      const results = await database.batch(unwrapped.map((item) => item.statement));
      if (guarded && afterRead) { const action = afterRead; afterRead = null; await action(); }
      return results;
    },
  };
  const store = await buildStoreModule(instrumented);
  await store.ensureNpdDatabase();
  const admin = await store.resolveNpdCurrentUser(null, null);
  const projectId = "npd-p-001";
  const initial = await store.getNpdProjectArchiveData(projectId, admin);
  const motorId = initial.motors[0].id;
  await database.batch([
    database.prepare(`INSERT INTO npd_documents
      (id,project_id,sheet_code,file_name,object_key,content_type,size,uploaded_by)
      VALUES ('snapshot-doc',?,'verification','归档测试.txt',?,'text/plain',1,?)`)
      .bind(projectId, `npd/${projectId}/snapshot-doc`, admin.id),
    database.prepare(`INSERT INTO npd_test_reports
      (id,project_id,motor_id,report_no,report_type,title,test_date,result,submitted_by,document_id)
      VALUES ('snapshot-test',?,?,'SNAP-TEST','型式试验','归档测试','2026-09-07','pass',?,'snapshot-doc')`)
      .bind(projectId, motorId, admin.id),
    database.prepare(`INSERT INTO npd_inspection_records
      (id,project_id,motor_id,item_type,inspection_requirement,inspection_date,result,inspector_id,document_id)
      VALUES ('snapshot-inspection',?,?,'motor','归档检验','2026-09-07','pass',?,'snapshot-doc')`)
      .bind(projectId, motorId, admin.id),
  ]);
  const update = (number) => {
    const value = `一致时点-${number}`;
    const changes = [
      ["npd_projects", "description", value, "id"],
      ["npd_sales_orders", "product_summary", value],
      ["npd_project_members", "responsibility", value],
      ["npd_project_motors", "cooling_method", value],
      ["npd_project_sheets", "note", value],
      ["npd_form_records", "payload", JSON.stringify({ marker: value })],
      ["npd_part_items", "specification", value],
      ["npd_test_reports", "conclusion", value],
      ["npd_inspection_records", "conclusion", value],
      ["npd_documents", "version", value],
      ["npd_activities", "detail", value],
      ["npd_sheet_revisions", "summary", value],
    ];
    return database.batch(changes.map(([table, column, entry, key = "project_id"]) =>
      database.prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`).bind(entry, projectId)).concat([
      database.prepare("UPDATE npd_customers SET contact=? WHERE id=?").bind(value, initial.project.customerId),
      database.prepare("UPDATE npd_users SET name=? WHERE id=?").bind(value, admin.id),
    ]));
  };
  function assertConsistent(data, expected) {
    const marker = data.project.description;
    if (expected != null) assert.equal(marker, `一致时点-${expected}`);
    assert.match(marker, /^一致时点-\d+$/);
    assert.equal(data.customer.contact, marker);
    assert.equal(data.exportedBy, marker);
    assert.match(data.capturedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    for (const [key, field] of Object.entries({ orders: "productSummary", members: "responsibility", motors: "coolingMethod",
      sheets: "note", parts: "specification", tests: "conclusion", inspections: "conclusion", documents: "version",
      activities: "detail", revisions: "summary" })) {
      assert.ok(data[key].length, `非空夹具 ${key}`);
      for (const row of data[key]) { assert.equal(row.projectId, projectId); assert.equal(row[field], marker, `${key}跨版本混读`); }
    }
    for (const form of data.forms) assert.equal(form.payload.marker, marker);
    assert.equal(data.project.motorCount, data.motors.length);
    assert.doesNotMatch(JSON.stringify(data), /password_hash|password_salt|token_hash/);
  }
  await update(0);
  guarded = true; batches = [];
  beforeRead = () => update(1);
  afterRead = () => update(2);
  assertConsistent(await store.getNpdProjectArchiveData(projectId, admin), 1);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 13);
  assert.ok(batches[0].every((sql) => sql.startsWith("WITH archive_project")));
  assertConsistent(await store.getNpdProjectArchiveData(projectId, admin), 2);
  // Competing D1 requests must see all-before or all-after, never mixed records.
  const reads = [];
  for (let index = 3; index < 13; index++) {
    reads.push(update(index));
    reads.push(store.getNpdProjectArchiveData(projectId, admin).then((data) => assertConsistent(data)));
  }
  await Promise.all(reads);
  batches = [];
  const workspace = await store.getNpdWorkspaceSnapshot(admin);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 15);
  assert.equal(workspace.projects.find((project) => project.id === projectId).description, "一致时点-12");
  guarded = false;
  const member = await store.createNpdUser({ email: "archive-member@example.test", name: "归档成员", role: "quality", department: "测试", active: true, password: "OnlyTest2026" }, admin);
  await database.prepare("INSERT INTO npd_project_members (id,project_id,user_id,responsibility) VALUES ('snapshot-member',?,?,'检验')").bind(projectId, member.id).run();
  assert.equal((await store.getNpdProjectArchiveData(projectId, member)).project.id, projectId);
  await database.prepare("DELETE FROM npd_project_members WHERE id='snapshot-member'").run();
  await assert.rejects(() => store.getNpdProjectArchiveData(projectId, member), /无权/);
  // The originally authenticated admin object must not preserve its old power.
  await database.prepare("UPDATE npd_users SET active=0 WHERE id=?").bind(admin.id).run();
  await assert.rejects(() => store.getNpdProjectArchiveData(projectId, admin), /无权|停用/);
  await assert.rejects(() => store.getNpdWorkspaceSnapshot(admin), /停用/);
  await database.prepare("UPDATE npd_users SET active=1,role='quality' WHERE id=?").bind(admin.id).run();
  const unrelated = (await database.prepare(`SELECT p.id FROM npd_projects p WHERE p.owner_id<>? AND p.initiator_id<>?
    AND NOT EXISTS (SELECT 1 FROM npd_project_members m WHERE m.project_id=p.id AND m.user_id=?) LIMIT 1`).bind(admin.id, admin.id, admin.id).first())?.id;
  assert.ok(unrelated, "需要非成员项目验证旧管理员身份");
  await assert.rejects(() => store.getNpdProjectArchiveData(unrelated, admin), /无权/);
  assert.ok(!(await store.getNpdWorkspaceSnapshot(admin)).projects.some((project) => project.id === unrelated));
  console.log("一致时点归档通过：单次只读事务、13组记录同版、并发前后边界、项目范围、当前账户/成员权限及看板同次读取。");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkArchiveSnapshot();
