export const revisionGroups = { forms: "受控表单", motors: "电机规格", parts: "零部件", tests: "试验报告", inspections: "质量检验", documents: "附件索引" };
type RecordRow = Record<string, unknown>;
const timestampKeys = new Set(["created_at", "updated_at", "confirmed_at"]);
const statusText: Record<string, string> = { planned: "计划中", not_started: "未开始", in_progress: "进行中", completed: "已完成",
  blocked: "受阻", pending_review: "待确认", draft: "草稿", submitted: "已提交" };

// Display only. Snapshot comparison and export keep the original values.
export function revisionDisplayValue(key: string, value: unknown): string {
  if (value === undefined || value === null) return "未记录";
  if (value === "") return "未填写";
  if (timestampKeys.has(key) && typeof value === "string") {
    const normalized = value.trim().replace(" ", "T");
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (match) {
      const day = new Date(`${match[1]}T00:00:00Z`);
      const parsed = new Date(match[6] ? normalized : `${normalized}Z`);
      if (Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === match[1] &&
          Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 && Number.isFinite(parsed.getTime())) {
        const beijing = new Date(parsed.getTime() + 8 * 3600000).toISOString().replace("T", " ");
        return `${beijing.slice(0, match[5] ? 23 : 19)}（北京时间）`;
      }
    }
    return `${value}（历史时间格式未识别，保留原值）`;
  }
  if (key === "status" && typeof value === "string") return statusText[value] || value;
  if (key === "item_type" && value === "motor") return "整机";
  if (key === "item_type" && value === "part") return "零部件";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.length ? value.map((item) => revisionDisplayValue("", item)).join("、") : "未选择";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}

export function originalEvidenceChecks(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || !("evidenceOriginals" in snapshot) || !Array.isArray(snapshot.evidenceOriginals)) return null;
  const rows = snapshot.evidenceOriginals;
  const ids = new Set<string>();
  if (!rows.length || rows.some((row) => {
    if (!row || typeof row !== "object" || typeof row.documentId !== "string" || !row.documentId || ids.has(row.documentId) ||
      typeof row.fileName !== "string" || !row.fileName || typeof row.etag !== "string" || !row.etag ||
      typeof row.checkedAt !== "string" || !Number.isFinite(Date.parse(row.checkedAt)) || !Number.isSafeInteger(row.size) || row.size < 1) return true;
    ids.add(row.documentId); return false;
  })) return null;
  return rows.map((row) => ({ documentId: String(row.documentId), fileName: String(row.fileName), size: Number(row.size),
    etag: String(row.etag), checkedAt: String(row.checkedAt) }));
}
export function snapshotRows(snapshot: unknown): Map<string, { label: string; value: RecordRow }> | null {
  if (!snapshot || typeof snapshot !== "object" || !("data" in snapshot)) return null;
  const data = snapshot.data;
  if (!data || typeof data !== "object") return null;
  const result = new Map<string, { label: string; value: RecordRow }>();
  for (const [group, title] of Object.entries(revisionGroups)) {
    const rows = (data as RecordRow)[group];
    if (!Array.isArray(rows)) return null;
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.id !== "string") return null;
      if (result.has(`${group}:${row.id}`)) return null;
      const value = { ...row };
      if (typeof value.payload === "string") { try { value.payload = JSON.parse(value.payload); } catch { /* Retain original text. */ } }
      result.set(`${group}:${row.id}`, { label: `${title} · ${row.form_code || row.model || row.part_no || row.report_no || row.file_name || row.id}`, value });
    }
  }
  return result;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function compareSnapshots(before: unknown, after: unknown) {
  const old = snapshotRows(before), next = snapshotRows(after);
  if (!old || !next) return null;
  return [...new Set([...old.keys(), ...next.keys()])].flatMap((key) => {
    const a = old.get(key), b = next.get(key);
    if (a && b && stable(a.value) === stable(b.value)) return [];
    return [{ key, label: (b || a)!.label, kind: !a ? "新增" : !b ? "移除" : "修改", before: a?.value, after: b?.value }];
  });
}
