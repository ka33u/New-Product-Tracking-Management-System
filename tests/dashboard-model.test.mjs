import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(new URL("../lib/dashboard-model.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildDashboardModel, businessDate, dashboardPeriod, defaultDashboardPreference, projectOverdueDays, readDashboardPreference, registeredBusinessDate, validateDashboardPreference } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const base = defaultDashboardPreference(new Date("2026-09-07T00:00:00Z"));
const month = { ...base, periodMode: "month", periodValue: "2026-09" };
const project = (id, extra = {}) => ({ id, ownerId: "design", status: "active", riskLevel: "high", progress: 50,
  motorCount: 2, plannedStart: "2026-09-01", plannedEnd: "2026-09-30", actualEnd: null,
  createdAt: "2026-09-01 02:00:00", overdueDays: 999, ...extra });

test("periods validate leap days, halves, empty inputs and reversed ranges", () => {
  assert.deepEqual(dashboardPeriod({ ...base, periodMode: "month", periodValue: "2024-02" }), { start: "2024-02-01", end: "2024-02-29" });
  assert.deepEqual(dashboardPeriod({ ...base, periodMode: "half", periodValue: "2026-H2" }), { start: "2026-07-01", end: "2026-12-31" });
  for (const bad of [{ periodMode: "month", periodValue: "2026-13" }, { periodMode: "half", periodValue: "2026-H3" },
    { periodMode: "year", periodValue: "" }, { periodMode: "year", periodValue: "2026-09" },
    { periodMode: "custom", customStart: "2026-02-29", customEnd: "2026-03-01" },
    { periodMode: "custom", customStart: "2026-09-07", customEnd: "2026-09-01" }]) {
    assert.throws(() => dashboardPeriod({ ...base, ...bad }));
  }
  assert.throws(() => validateDashboardPreference({ ...base, visibleMetrics: ["unknown"] }));
  assert.throws(() => validateDashboardPreference({ ...base, visibleMetrics: ["total", "total"] }));
  assert.throws(() => validateDashboardPreference({ ...base, visibleMetrics: [] }));
  assert.throws(() => validateDashboardPreference(null));
  assert.doesNotThrow(() => validateDashboardPreference(readDashboardPreference({ visibleMetrics: "bad" })));
});

test("Beijing dates control calendar boundaries and UTC registration timestamps", () => {
  assert.equal(businessDate(new Date("2026-12-31T16:00:00Z")), "2027-01-01");
  assert.equal(registeredBusinessDate("2026-08-31 16:00:00"), "2026-09-01");
  assert.equal(registeredBusinessDate("2026-08-31T15:59:59Z"), "2026-08-31");
  assert.equal(registeredBusinessDate("2026-09-01T00:00:00+08:00"), "2026-09-01");
  assert.equal(registeredBusinessDate("2026-02-30 12:00:00"), null);
  assert.equal(registeredBusinessDate("2026-09-01T12:00:00"), null);
  const model = buildDashboardModel([project("utc", { createdAt: "2026-08-31 16:00:00" })], month, "design", "2026-09-07");
  assert.equal(model.buckets[0].registered, 1);
});

test("one project cohort drives all metrics and flow; carryover stays visible and closure is not overdue", () => {
  const rows = [
    project("carry", { plannedStart: "2026-08-01", plannedEnd: "2026-08-31" }),
    project("paused", { status: "paused", plannedEnd: "2026-09-06" }),
    project("cancelled", { status: "cancelled", plannedEnd: "2026-09-01", progress: 0 }),
    project("on-time", { status: "completed", plannedEnd: "2026-09-05", actualEnd: "2026-09-05", progress: 100 }),
    project("late", { status: "completed", plannedEnd: "2026-09-01", actualEnd: "2026-09-04", progress: 100 }),
    project("missing", { status: "completed", progress: 100 }),
    project("reopened", { actualEnd: "2026-09-03" }),
    project("other-owner", { ownerId: "sales" }),
    project("future", { plannedStart: "2027-01-01", plannedEnd: "2027-06-01" }),
    project("old-closed", { status: "completed", plannedStart: "2026-01-01", plannedEnd: "2026-06-30", actualEnd: "2026-06-20" }),
    project("bad-plan", { plannedStart: "bad" }),
  ];
  const model = buildDashboardModel(rows, month, "design", "2026-09-07");
  assert.deepEqual(model.projects.map((row) => row.id), ["carry", "paused", "cancelled", "on-time", "late", "missing", "reopened"]);
  assert.deepEqual(model.values, { total: 7, active: 2, completed: 3, onTime: 1, overdue: 2, motors: 14, averageProgress: 75, highRisk: 3 });
  assert.equal(model.statusItems.reduce((sum, row) => sum + row.count, 0), model.values.total);
  assert.equal(model.buckets.length, 1);
  assert.equal(model.buckets[0].registered, 7);
  assert.equal(model.buckets[0].completed, 2, "缺少完成日期和重开的项目不能算完成流量");
  assert.equal(model.missingCompletionDates, 1);
  assert.equal(model.invalidPlans, 1);
  assert.equal(model.projects[0].overdueDays, 7);
  assert.equal(projectOverdueDays(rows[2], "2026-09-07"), 0);
  assert.equal(projectOverdueDays(rows[4], "2026-09-07"), 0);
  assert.equal(buildDashboardModel(rows, month, "sales", "2026-09-07").values.total, 1);
  const none = buildDashboardModel(rows, month, "unassigned", "2026-09-07");
  assert.equal(none.values.averageProgress, null);
  assert.equal(none.buckets[0].registered, 0);
});

test("custom partial months clip events, all periods reconcile and huge ranges stay bounded", () => {
  const custom = { ...base, periodMode: "custom", customStart: "2026-08-31", customEnd: "2026-09-02" };
  const rows = [project("before", { createdAt: "2026-08-30 00:00:00" }), project("in", { createdAt: "2026-09-01 00:00:00" }), project("after", { createdAt: "2026-09-03 00:00:00" })];
  const model = buildDashboardModel(rows, custom, "all", "2026-09-07");
  assert.deepEqual(model.buckets.map((row) => [row.start, row.end, row.registered]), [["2026-08-31", "2026-08-31", 0], ["2026-09-01", "2026-09-02", 1]]);
  for (const preference of [base, { ...base, periodMode: "half", periodValue: "2026-H1" }, month, custom]) {
    const report = buildDashboardModel(rows, preference, "all", "2026-09-07");
    const expected = report.projects.filter((row) => { const date = registeredBusinessDate(row.createdAt); return date >= report.period.start && date <= report.period.end; }).length;
    assert.equal(report.buckets.reduce((sum, row) => sum + row.registered, 0), expected);
  }
  const huge = buildDashboardModel([], { ...custom, customStart: "1000-01-01", customEnd: "9999-12-31" }, "all", "2026-09-07");
  assert.ok(huge.buckets.length <= 24);
  assert.equal(huge.buckets[0].start, "1000-01-01");
  assert.equal(huge.buckets.at(-1).end, "9999-12-31");
  const future = buildDashboardModel([project("future-completed", { status: "completed", actualEnd: "2026-09-20", createdAt: "bad" })], month, "all", "2026-09-07");
  assert.equal(future.values.onTime, 0);
  assert.equal(future.missingCompletionDates, 1);
  assert.equal(future.missingRegisteredDates, 1);
});
