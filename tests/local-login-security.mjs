import assert from "node:assert/strict";
import { D1Adapter, buildStoreModule } from "./store-harness.mjs";
import { applyLocalMigrations } from "../scripts/local-migrations.mjs";

export async function checkLoginSecurity(database = new D1Adapter()) {
  let store = await buildStoreModule(database, { NPD_DEMO_DATA: "0" });
  const setup = await store.setupNpdLocalAdmin({ email: "owner@example.test", name: "登录测试", department: "测试", password: "CorrectOnly2026" });
  await store.endNpdLocalSession(setup.token);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
    store.authenticateNpdLocalUser(i % 2 ? " OWNER@example.test " : "owner@example.test", "WrongOnly2026")));
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason.name === "NpdLoginRateLimitError").length, 10);
  assert.equal(results.filter((result) => result.status === "rejected" && /邮箱或密码不正确/.test(result.reason.message)).length, 10);
  let bucket = await database.prepare("SELECT * FROM npd_local_login_limits WHERE bucket LIKE 'account:%'").first();
  assert.equal(bucket.attempt_count, 10);
  assert.match(bucket.bucket, /^account:[a-f0-9]{64}$/);
  assert.equal((await database.prepare("SELECT COUNT(*) n FROM npd_local_sessions").first()).n, 0);
  // A fresh application module against the same DB cannot reset the limit.
  store = await buildStoreModule(database, { NPD_DEMO_DATA: "0" });
  await assert.rejects(() => store.authenticateNpdLocalUser("owner@example.test", "CorrectOnly2026"), (error) =>
    error.name === "NpdLoginRateLimitError" && error.retryAfterSeconds > 0 && error.retryAfterSeconds <= 900);
  await database.prepare("UPDATE npd_local_login_limits SET window_started_at=unixepoch()-901 WHERE bucket LIKE 'account:%'").run();
  await database.prepare("UPDATE npd_users SET updated_at='2000-01-01 00:00:00'").run();
  const success = await store.authenticateNpdLocalUser("owner@example.test", "CorrectOnly2026");
  assert.ok(await store.resolveNpdLocalSession(success.token));
  assert.equal((await database.prepare("SELECT updated_at FROM npd_users WHERE id=?").bind(success.user.id).first()).updated_at, "2000-01-01 00:00:00", "正常登录不能造成账户维护假冲突");
  bucket = await database.prepare("SELECT * FROM npd_local_login_limits WHERE bucket LIKE 'account:%'").first();
  assert.equal(bucket.attempt_count, 1);
  // Unknown accounts consume the same normalized per-account ceiling.
  for (let i = 0; i < 10; i++) await assert.rejects(() => store.authenticateNpdLocalUser("unknown@example.test", "WrongOnly2026"), /邮箱或密码不正确/);
  await assert.rejects(() => store.authenticateNpdLocalUser("unknown@example.test", "WrongOnly2026"), (error) => error.name === "NpdLoginRateLimitError");
  // Global cap prevents using unbounded distinct account buckets.
  await database.prepare("UPDATE npd_local_login_limits SET attempt_count=60,window_started_at=unixepoch() WHERE bucket='local-global'").run();
  const countBefore = (await database.prepare("SELECT COUNT(*) n FROM npd_local_login_limits").first()).n;
  await assert.rejects(() => store.authenticateNpdLocalUser("another@example.test", "WrongOnly2026"), (error) => error.name === "NpdLoginRateLimitError" && error.retryAfterSeconds <= 60);
  assert.equal((await database.prepare("SELECT COUNT(*) n FROM npd_local_login_limits").first()).n, countBefore);
  assert.ok(await store.resolveNpdLocalSession(success.token), "限速不撤销已有正常会话");
  await database.prepare("UPDATE npd_local_login_limits SET window_started_at=unixepoch()-61 WHERE bucket='local-global'").run();
  await database.prepare("INSERT INTO npd_local_login_limits VALUES ('expired-test',unixepoch()-3601,9)").run();
  const resumed = await store.authenticateNpdLocalUser("owner@example.test", "CorrectOnly2026");
  assert.ok(resumed.token);
  assert.equal(await database.prepare("SELECT bucket FROM npd_local_login_limits WHERE bucket='expired-test'").first(), null);
  console.log("登录限速通过：并发原子计数、大小写归一、模块重启保留、到期恢复、未知账户、全局上限、旧会话不受影响及过期清理。");
}

async function checkCredentialRace() {
  for (const mutation of ["active=0", "password_hash='replaced-while-hashing'"]) {
    const database = new D1Adapter();
    const store = await buildStoreModule(database, { NPD_DEMO_DATA: "0" });
    const setup = await store.setupNpdLocalAdmin({ email: "race@example.test", name: "竞态", department: "测试", password: "CorrectOnly2026" });
    await store.endNpdLocalSession(setup.token);
    const before = (await database.prepare("SELECT COUNT(*) n FROM npd_activities").first()).n;
    const batch = database.batch.bind(database);
    let injected = false;
    database.batch = async (statements) => {
      if (!injected && statements.some((statement) => statement.sql.includes("INSERT INTO npd_local_sessions"))) {
        injected = true;
        // Simulate the administrator committing after password verification.
        await database.prepare(`UPDATE npd_users SET ${mutation} WHERE id=?`).bind(setup.user.id).run();
      }
      return batch(statements);
    };
    await assert.rejects(() => store.authenticateNpdLocalUser("race@example.test", "CorrectOnly2026"), /登录期间发生变更/);
    assert.ok(injected);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM npd_local_sessions").first()).n, 0);
    assert.equal((await database.prepare("SELECT COUNT(*) n FROM npd_activities").first()).n, before);
    assert.equal((await database.prepare("SELECT last_login_at FROM npd_users WHERE id=?").bind(setup.user.id).first()).last_login_at, null);
  }
  console.log("登录竞态通过：验证后停用/重置密码不能签发会话，失败不留下成功登录记录。");
}

async function checkMigration() {
  const database = new D1Adapter();
  database.failNextBatchMatching = /CREATE INDEX/;
  await assert.rejects(() => applyLocalMigrations(database), /Injected/);
  assert.equal(await database.prepare("SELECT name FROM sqlite_schema WHERE name='npd_local_login_limits'").first(), null);
  assert.equal((await database.prepare("SELECT COUNT(*) n FROM __npd_local_migrations").first()).n, 0);
  await applyLocalMigrations(database);
  await database.prepare("INSERT INTO npd_local_login_limits VALUES ('preserved',123,4)").run();
  await applyLocalMigrations(database);
  assert.equal((await database.prepare("SELECT attempt_count FROM npd_local_login_limits WHERE bucket='preserved'").first()).attempt_count, 4);
  await database.prepare("UPDATE __npd_local_migrations SET checksum='changed'").run();
  await assert.rejects(() => applyLocalMigrations(database), /被修改/);
  console.log("新迁移检查通过：失败原子回退、重启不重建数据、已应用文件校验不一致拒绝继续。");
}

async function checkSetupLimit() {
  const database = new D1Adapter();
  const store = await buildStoreModule(database, { NPD_DEMO_DATA: "0" });
  for (let i = 0; i < 5; i++) await assert.rejects(() => store.setupNpdLocalAdmin({
    email: `setup-${i}@example.test`, name: "", department: "测试", password: "CorrectOnly2026",
  }), /请填写/);
  await assert.rejects(() => store.setupNpdLocalAdmin({ email: "valid@example.test", name: "管理员", department: "测试", password: "CorrectOnly2026" }), (error) => error.name === "NpdLoginRateLimitError");
  assert.equal((await database.prepare("SELECT COUNT(*) n FROM npd_users").first()).n, 0);
  await database.prepare("UPDATE npd_local_login_limits SET window_started_at=unixepoch()-901 WHERE bucket='local-setup'").run();
  const setup = await store.setupNpdLocalAdmin({ email: "valid@example.test", name: "管理员", department: "测试", password: "CorrectOnly2026" });
  assert.equal(setup.user.role, "admin");
  await assert.rejects(() => store.setupNpdLocalAdmin({ email: "new@example.test", name: "替代者", department: "测试", password: "CorrectOnly2026" }), /已初始化/);
  console.log("首次设置限速通过：换邮箱不能绕过、失败不创建管理员、等待结束可设置且之后不重新开放。");
}

if (process.argv[1]?.endsWith("local-login-security.mjs")) {
  await checkLoginSecurity(); await checkCredentialRace(); await checkMigration(); await checkSetupLimit();
}
