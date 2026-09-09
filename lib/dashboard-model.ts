import type { DashboardPreference, NpdProject, ProjectStatus } from "./npd-v2";

export const dashboardMetrics = [
  ["total", "项目总数", "folder", "计划周期与区间相交，另含区间内已开始且截至今日仍未关闭的项目。"],
  ["active", "进行中", "chart", "筛选范围内当前状态为进行中的项目，不含草稿或暂停。"],
  ["completed", "已完成", "check", "筛选范围内当前已完成的项目，不代表全部都在所选区间内完成。"],
  ["onTime", "按期完成", "clock", "当前已完成且实际完成日期不晚于计划完成日期；缺少有效日期不计入。"],
  ["overdue", "未结逾期", "alert", "草稿、进行中或暂停项目，计划完成日期早于今日；不含已完成或已终止。"],
  ["motors", "电机规格", "motor", "筛选范围内各项目的电机规格数之和，不是电机台数。"],
  ["averageProgress", "平均进度", "chart", "未终止项目按项目等权平均；没有有效项目时显示破折号。"],
  ["highRisk", "未结高风险", "shield", "尚未关闭且风险为高或严重的项目；不含已完成或已终止。"],
] as const;

export function businessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function validBusinessDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function monthEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function dashboardPeriod(preference: Pick<DashboardPreference, "periodMode" | "periodValue" | "customStart" | "customEnd">) {
  const { periodMode, periodValue, customStart, customEnd } = preference;
  if (typeof periodValue !== "string") throw new Error("请选择有效的统计周期。");
  if (periodMode === "custom") {
    if (!validBusinessDate(customStart) || !validBusinessDate(customEnd)) throw new Error("请完整填写有效的起止日期。");
    if (customStart > customEnd) throw new Error("统计开始日期不能晚于结束日期。");
    return { start: customStart, end: customEnd };
  }
  if (periodMode === "year" && /^[1-9]\d{3}$/.test(periodValue)) return { start: `${periodValue}-01-01`, end: `${periodValue}-12-31` };
  if (periodMode === "half" && /^[1-9]\d{3}-H[12]$/.test(periodValue)) {
    const year = periodValue.slice(0, 4);
    return periodValue.endsWith("H2") ? { start: `${year}-07-01`, end: `${year}-12-31` } : { start: `${year}-01-01`, end: `${year}-06-30` };
  }
  if (periodMode === "month" && validBusinessDate(`${periodValue}-01`)) {
    return { start: `${periodValue}-01`, end: monthEnd(Number(periodValue.slice(0, 4)), Number(periodValue.slice(5))) };
  }
  throw new Error("请选择有效的年度、半年度或月份。");
}

export function defaultDashboardPreference(now = new Date()): DashboardPreference {
  return { periodMode: "year", periodValue: businessDate(now).slice(0, 4), customStart: "", customEnd: "", visibleMetrics: dashboardMetrics.map(([key]) => key) };
}

export function validateDashboardPreference(value: unknown): DashboardPreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("看板配置无效。");
  const row = value as DashboardPreference;
  dashboardPeriod(row);
  if (typeof row.customStart !== "string" || typeof row.customEnd !== "string" ||
    !Array.isArray(row.visibleMetrics) || row.visibleMetrics.length === 0 || row.visibleMetrics.length > dashboardMetrics.length ||
    new Set(row.visibleMetrics).size !== row.visibleMetrics.length ||
    row.visibleMetrics.some((key) => !dashboardMetrics.some(([known]) => known === key))) throw new Error("请至少选择一项有效且不重复的看板指标。");
  return { periodMode: row.periodMode, periodValue: row.periodValue, customStart: row.customStart, customEnd: row.customEnd, visibleMetrics: [...row.visibleMetrics] };
}

export function readDashboardPreference(value: unknown): DashboardPreference {
  try { return validateDashboardPreference(value); } catch { return defaultDashboardPreference(); }
}

const openStatuses: ProjectStatus[] = ["draft", "active", "paused"];
export function projectOverdueDays(project: Pick<NpdProject, "status" | "plannedEnd">, asOf = businessDate()) {
  if (!openStatuses.includes(project.status) || !validBusinessDate(project.plannedEnd) || project.plannedEnd >= asOf) return 0;
  return Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${project.plannedEnd}T00:00:00Z`)) / 86400000);
}

// SQLite timestamps are UTC; business dates and report boundaries are Beijing dates.
export function registeredBusinessDate(timestamp: string): string | null {
  if (validBusinessDate(timestamp)) return timestamp;
  if (typeof timestamp !== "string" || !validBusinessDate(timestamp.slice(0, 10))) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp) ? `${timestamp.replace(" ", "T")}Z` : timestamp;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(normalized)) return null;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? businessDate(date) : null;
}

export interface DashboardBucket { start: string; end: string; label: string; registered: number; completed: number }
function periodBuckets(start: string, end: string): DashboardBucket[] {
  const first = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1;
  const last = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7)) - 1;
  const step = Math.max(1, Math.ceil((last - first + 1) / 24));
  const buckets: DashboardBucket[] = [];
  for (let month = first; month <= last; month += step) {
    const final = Math.min(last, month + step - 1);
    const from = `${Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, "0")}`;
    const to = `${Math.floor(final / 12)}-${String(final % 12 + 1).padStart(2, "0")}`;
    buckets.push({ start: from === start.slice(0, 7) ? start : `${from}-01`,
      end: to === end.slice(0, 7) ? end : monthEnd(Math.floor(final / 12), final % 12 + 1),
      label: from === to ? from : `${from}～${to}`, registered: 0, completed: 0 });
  }
  return buckets;
}

export function buildDashboardModel(input: NpdProject[], preference: DashboardPreference, ownerId = "all", asOf = businessDate()) {
  const period = dashboardPeriod(preference);
  const projects = input.filter((project) => {
    if (ownerId !== "all" && project.ownerId !== ownerId) return false;
    const validPlan = validBusinessDate(project.plannedStart) && validBusinessDate(project.plannedEnd) && project.plannedStart <= project.plannedEnd;
    const plannedOverlap = validPlan && project.plannedStart <= period.end && project.plannedEnd >= period.start;
    const carryover = validPlan && openStatuses.includes(project.status) && project.plannedStart <= period.end && project.plannedStart <= asOf && period.start <= asOf;
    return plannedOverlap || carryover;
  }).map((project) => ({ ...project, overdueDays: projectOverdueDays(project, asOf) }));
  const closed = projects.filter((project) => project.status === "completed");
  const completionDate = (project: NpdProject) => typeof project.actualEnd === "string" && validBusinessDate(project.actualEnd) && project.actualEnd <= asOf ? project.actualEnd : null;
  const progressProjects = projects.filter((project) => project.status !== "cancelled" && Number.isFinite(project.progress) && project.progress >= 0 && project.progress <= 100);
  const values: Record<string, number | null> = {
    total: projects.length, active: projects.filter((project) => project.status === "active").length,
    completed: closed.length, onTime: closed.filter((project) => completionDate(project) && project.actualEnd! <= project.plannedEnd).length,
    overdue: projects.filter((project) => project.overdueDays > 0).length,
    motors: projects.reduce((sum, project) => sum + project.motorCount, 0),
    averageProgress: progressProjects.length ? Math.round(progressProjects.reduce((sum, project) => sum + project.progress, 0) / progressProjects.length) : null,
    highRisk: projects.filter((project) => openStatuses.includes(project.status) && ["high", "critical"].includes(project.riskLevel)).length,
  };
  const statusItems = (["active", "completed", "paused", "draft", "cancelled"] as const).map((status) => ({ status, count: projects.filter((project) => project.status === status).length }));
  const buckets = periodBuckets(period.start, period.end);
  let missingRegisteredDates = 0;
  for (const project of projects) {
    const registered = registeredBusinessDate(project.createdAt);
    if (!registered || registered > asOf) missingRegisteredDates++;
    else {
      const bucket = buckets.find((item) => registered >= item.start && registered <= item.end);
      if (bucket) bucket.registered++;
    }
    if (project.status === "completed") {
      const completed = completionDate(project);
      const bucket = completed && buckets.find((item) => completed >= item.start && completed <= item.end);
      if (bucket) bucket.completed++;
    }
  }
  const invalidPlans = input.filter((project) => (ownerId === "all" || project.ownerId === ownerId) &&
    (!validBusinessDate(project.plannedStart) || !validBusinessDate(project.plannedEnd) || project.plannedStart > project.plannedEnd)).length;
  return { period, projects, values, statusItems, buckets, invalidPlans, missingRegisteredDates,
    missingCompletionDates: closed.filter((project) => !completionDate(project)).length };
}
