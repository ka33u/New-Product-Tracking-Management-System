import { sheetByCode } from "../lib/sheets-v2";
import type { NpdProject, SheetCode, SheetStatus } from "../lib/npd-v2";

type Row = Record<string, string | number | null>;
export class NpdConflictError extends Error {
  constructor() { super("内容已被其他操作更新，本次未保存。请保留当前填写内容，关闭后重新打开最新版本再修改。"); this.name = "NpdConflictError"; }
}
export function assertExpectedVersion(expected: unknown, actual: number) {
  if (!Number.isSafeInteger(expected) || Number(expected) < 0) throw new Error("缺少有效版本号，请刷新页面后重试。");
  if (expected !== actual) throw new NpdConflictError();
}
export async function loadRevisionContext(database: D1Database, projectId: string,
  authorizedProject?: Pick<NpdProject, "lifecycleVersion" | "ownershipVersion">) {
  const sheets = await database.prepare("SELECT * FROM npd_project_sheets WHERE project_id=? ORDER BY sort_order").bind(projectId).all<Row>();
  const project = await database.prepare("SELECT status,lifecycle_version,ownership_version FROM npd_projects WHERE id=?").bind(projectId).first<Row>();
  if (!project || !sheets.results.length) throw new Error("项目或阶段不存在。");
  if (authorizedProject && (authorizedProject.lifecycleVersion !== Number(project.lifecycle_version) ||
    authorizedProject.ownershipVersion !== Number(project.ownership_version))) throw new NpdConflictError();
  return { sheets: sheets.results, status: String(project.status), lifecycleVersion: Number(project.lifecycle_version),
    ownershipVersion: Number(project.ownership_version) };
}
type Context = Awaited<ReturnType<typeof loadRevisionContext>>;
export type SheetRevisionChange = {
  action: string; summary: string; reason?: string; status?: SheetStatus;
  progress?: number; plannedDate?: string; note?: string; snapshot?: Record<string, unknown>;
  context?: Context;
  mutations?: D1PreparedStatement[];
  guard?: { sql: string; values: (string | number | null)[] };
  actorRole?: string;
  relatedProgress?: { code: "parts_plan" | "verification" | "quality_inspection"; progress: number; note: string }[];
};

const snapshotTables = { forms: "npd_form_records", motors: "npd_project_motors", parts: "npd_part_items",
  tests: "npd_test_reports", inspections: "npd_inspection_records", documents: "npd_documents" };
const snapshotExpressions = new WeakMap<D1Database, Promise<string>>();
export function snapshotExpression(database: D1Database) {
  let expression = snapshotExpressions.get(database);
  if (!expression) {
    expression = Promise.all(Object.entries(snapshotTables).map(async ([key, table]) => {
      const columns = await database.prepare(`PRAGMA table_info(${table})`).all<Row>();
      const names = columns.results.map((column) => String(column.name));
      if (!names.length || names.some((name) => !/^[a-z_]+$/.test(name))) throw new Error("版本快照表结构无效。");
      const fields = names.map((name) => `'${name}',"${name}"`).join(",");
      return `'${key}',json((SELECT json_group_array(json_object(${fields})) FROM (SELECT * FROM ${table} WHERE project_id=? ORDER BY id)))`;
    })).then((entries) => `json_object(${entries.join(",")})`);
    snapshotExpressions.set(database, expression);
  }
  return expression;
}

export function activityStatement(database: D1Database, projectId: string, actorId: string, action: string, entityType: string, entityId: string, detail: string) {
  return database.prepare(`INSERT INTO npd_activities (id,project_id,actor_id,action,entity_type,entity_id,detail)
    VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), projectId, actorId, action, entityType, entityId, detail);
}

export async function commitSheetRevision(database: D1Database, projectId: string, sheetCode: SheetCode,
  actorId: string, change: SheetRevisionChange, invalidateDownstream: boolean, businessDate: string) {
  const context = change.context || await loadRevisionContext(database, projectId);
  const current = context.sheets.find((sheet) => sheet.code === sheetCode);
  if (!current) throw new Error("项目阶段 Sheet 不存在。");
  const status = invalidateDownstream && current.status === "completed" && change.status === undefined
    ? "pending_review" : change.status || String(current.status) as SheetStatus;
  const progress = status === "completed" ? 100 : Math.max(0, Math.min(99, Math.round(change.progress ?? Number(current.progress || 0))));
  const plannedDate = change.plannedDate || String(current.planned_date);
  const note = change.note === undefined ? String(current.note || "") : change.note.trim();
  const actualDate = status === "completed" ? current.actual_date || businessDate : null;
  const version = Number(current.version) + 1;
  const revisionId = crypto.randomUUID();
  const expected = JSON.stringify(context.sheets.map((sheet) => ({ code: sheet.code, version: sheet.version, status: sheet.status })));
  const guard = change.guard || { sql: "1=1", values: [] };
  const dataSql = await snapshotExpression(database);
  const snapshotUpdate = (id: string, metadata: Record<string, unknown>) => database.prepare(
    `UPDATE npd_sheet_revisions SET snapshot=json_set(?,'$.data',${dataSql}) WHERE id=?`,
  ).bind(JSON.stringify(metadata), ...Object.keys(snapshotTables).map(() => projectId), id);

  // The first INSERT deliberately uses the existing NOT NULL constraint to
  // abort the entire D1 batch if any validated input changed before commit.
  // It is not a separate lock and cannot be stranded by a failed request.
  const statements: D1PreparedStatement[] = [database.prepare(`INSERT INTO npd_sheet_revisions
    (id,project_id,sheet_code,version,action,summary,reason,status,progress,planned_date,actor_id,snapshot)
    VALUES (?,?,?,?,?,?,?,?,?,?,CASE WHEN
      (SELECT COUNT(*) FROM npd_project_sheets WHERE project_id=?)=?
      AND NOT EXISTS (SELECT 1 FROM json_each(?) e LEFT JOIN npd_project_sheets s
        ON s.project_id=? AND s.code=json_extract(e.value,'$.code')
        WHERE s.id IS NULL OR s.version<>json_extract(e.value,'$.version') OR s.status<>json_extract(e.value,'$.status'))
      AND EXISTS (SELECT 1 FROM npd_projects p JOIN npd_users u ON u.id=?
        WHERE p.id=? AND p.status=? AND p.lifecycle_version=? AND p.ownership_version=? AND p.status<>'paused'
        AND u.active=1 AND (? IS NULL OR u.role=?)
        AND (p.status NOT IN ('completed','cancelled') OR u.role='admin')
        AND (u.role='admin' OR p.initiator_id=u.id OR p.owner_id=u.id OR EXISTS
          (SELECT 1 FROM npd_project_members m WHERE m.project_id=p.id AND m.user_id=u.id)))
      AND (${guard.sql}) THEN ? ELSE NULL END,'{}')`).bind(
    revisionId, projectId, sheetCode, version, change.action, change.summary, change.reason?.trim() || "日常维护",
    status, progress, plannedDate, projectId, context.sheets.length, expected, projectId,
    actorId, projectId, context.status, context.lifecycleVersion, context.ownershipVersion, change.actorRole || null, change.actorRole || null, ...guard.values, actorId,
  ), ...(change.mutations || []), database.prepare(`UPDATE npd_project_sheets SET status=?,progress=?,planned_date=?,actual_date=?,
      note=?,version=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE project_id=? AND code=?`).bind(
    status, progress, plannedDate, actualDate, note, version, actorId, projectId, sheetCode,
  ), snapshotUpdate(revisionId, { status, progress, plannedDate, actualDate, note, ...(change.snapshot || {}) })];

  if (invalidateDownstream) {
    const reason = `${sheetByCode[sheetCode].shortTitle}发生变更：${change.summary}`;
    const related = new Map((change.relatedProgress || []).map((item) => [item.code as string, item]));
    for (const row of context.sheets.filter((sheet) => Number(sheet.sort_order) > Number(current.sort_order) &&
      (["completed", "pending_review"].includes(String(sheet.status)) || related.has(String(sheet.code))))) {
      const downstreamId = crypto.randomUUID();
      const derived = related.get(String(row.code));
      const downstreamProgress = derived ? Math.max(0, Math.min(90, Math.round(derived.progress))) : Math.min(90, Number(row.progress || 0));
      const downstreamStatus = ["completed", "pending_review"].includes(String(row.status)) ? "pending_review"
        : row.status === "not_started" && downstreamProgress > 0 ? "in_progress" : String(row.status);
      const downstreamNote = derived
        ? `${row.status === "blocked" && row.note ? `${row.note}\n` : ""}关联更新：${reason}；${derived.note}`
        : `待复核：${reason}`;
      statements.push(database.prepare(`INSERT INTO npd_sheet_revisions
        (id,project_id,sheet_code,version,action,summary,reason,status,progress,planned_date,actor_id,snapshot)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'{}')`)
        .bind(downstreamId, projectId, String(row.code), Number(row.version) + 1,
          derived ? "重算关联证据进度" : "触发下游复核",
          derived ? derived.note : "上游数据变更，原阶段结论保留并转为待复核",
          reason, downstreamStatus, downstreamProgress, String(row.planned_date), actorId),
      database.prepare(`UPDATE npd_project_sheets SET status=?,progress=?,actual_date=NULL,note=?,
        version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .bind(downstreamStatus, downstreamProgress, downstreamNote, actorId, String(row.id)),
      snapshotUpdate(downstreamId, { previousStatus: row.status, previousVersion: row.version, previousProgress: row.progress,
        previousNote: row.note, status: downstreamStatus, progress: downstreamProgress, note: downstreamNote }));
    }
  }
  // Recompute from committed rows inside the same batch, not in a later request.
  statements.push(database.prepare(`UPDATE npd_projects SET
    progress=(SELECT CAST(ROUND(AVG(progress)) AS INTEGER) FROM npd_project_sheets WHERE project_id=?),
    current_sheet_code=COALESCE((SELECT code FROM npd_project_sheets WHERE project_id=? AND status<>'completed' ORDER BY sort_order LIMIT 1),'change_archive'),
    lifecycle_version=lifecycle_version+CASE WHEN status=CASE WHEN status IN ('paused','cancelled') THEN status
      WHEN NOT EXISTS (SELECT 1 FROM npd_project_sheets WHERE project_id=? AND status<>'completed') THEN 'completed' ELSE 'active' END THEN 0 ELSE 1 END,
    status=CASE WHEN status IN ('paused','cancelled') THEN status
      WHEN NOT EXISTS (SELECT 1 FROM npd_project_sheets WHERE project_id=? AND status<>'completed') THEN 'completed' ELSE 'active' END,
    actual_end=CASE WHEN status NOT IN ('paused','cancelled') AND NOT EXISTS
      (SELECT 1 FROM npd_project_sheets WHERE project_id=? AND status<>'completed') THEN COALESCE(actual_end,?) ELSE NULL END,
    updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(projectId, projectId, projectId, projectId, projectId, businessDate, projectId));
  try { await database.batch(statements); }
  catch (error) {
    if (/NOT NULL constraint failed: npd_sheet_revisions.actor_id|UNIQUE constraint failed: npd_sheet_revisions.project_id/i.test(String(error))) throw new NpdConflictError();
    throw error;
  }
  return version;
}
