"use client";
import { formDefinitions } from "../../../lib/forms";
import type { NpdFormRecord } from "../../../lib/npd-v2";
import { formatDateTime, Modal, StatusBadge } from "./ui";

export function displayFormValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "未填写";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.length ? value.map(displayFormValue).join("、") : "未选择";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function ReadOnlyForm({ projectCode, formCode, record, onClose }: {
  projectCode: string; formCode: string; record?: NpdFormRecord; onClose: () => void;
}) {
  const definition = formDefinitions.find((form) => form.code === formCode);
  if (!definition) return <Modal title="表单不可用" onClose={onClose}><p>未找到该表单定义。</p></Modal>;
  const extra = Object.entries(record?.payload || {}).filter(([key]) => !definition.fields.some((field) => field.key === key));
  return <Modal title={definition.name} eyebrow={`${projectCode} · ${definition.code} · 只读查看`} onClose={onClose} wide>
    <p>{definition.purpose}</p>
    <p><StatusBadge value={record?.status || "not_started"} label={record?.status === "submitted" ? "已提交" : record ? "草稿（未正式提交）" : "尚未填写"} />
      {record && <> · V{record.version} · {record.updatedByName || "未记录人员"} · {formatDateTime(record.updatedAt)}</>}</p>
    <dl className="npd2-form-readonly">{definition.fields.map((field) => <div key={field.key}>
      <dt>{field.label}{field.required ? "（必填）" : ""}</dt><dd>{displayFormValue(record?.payload[field.key])}</dd>
    </div>)}</dl>
    {extra.length > 0 && <details><summary>其他已保存字段（{extra.length} 项）</summary><dl className="npd2-form-readonly">
      {extra.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{displayFormValue(value)}</dd></div>)}
    </dl></details>}
    <p>本窗口仅查看当前保存版本，不会修改记录。历史内容可在“版本与修改记录”中查看。</p>
    <div className="npd2-submit-bar"><button className="npd2-button npd2-button-primary" onClick={onClose}>关闭查看</button></div>
  </Modal>;
}
