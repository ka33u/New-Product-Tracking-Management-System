"use client";
import { useEffect, useState } from "react";
import type { SheetRevision } from "../../../lib/npd-v2";
import { sheetStatusLabels } from "../../../lib/npd-v2";
import { RevisionValues as Values } from "./RevisionValues";
import { compareSnapshots, originalEvidenceChecks, snapshotRows } from "../../../lib/revision-view";
import { formatDateTime, Modal } from "./ui";

export function RevisionDetail({ revision, revisions, onClose }: { revision: SheetRevision; revisions: SheetRevision[]; onClose: () => void }) {
  const [compareId, setCompareId] = useState("");
  const [loaded, setLoaded] = useState<{ snapshot: unknown; before?: unknown } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null); setError("");
    async function read(id: string) {
      const response = await fetch(`/api/revisions/${encodeURIComponent(id)}`, { signal: controller.signal, cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "读取版本失败。");
      return body.snapshot;
    }
    Promise.all([read(revision.id), compareId ? read(compareId) : Promise.resolve(undefined)])
      .then(([snapshot, before]) => { if (!controller.signal.aborted) setLoaded({ snapshot, before }); })
      .catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "读取失败。"); });
    return () => controller.abort();
  }, [revision.id, compareId]);
  const rows = loaded ? snapshotRows(loaded.snapshot) : null;
  const changes = loaded && compareId ? compareSnapshots(loaded.before, loaded.snapshot) : null;
  const baseline = revisions.find((item) => item.id === compareId);
  const originalChecks = loaded ? originalEvidenceChecks(loaded.snapshot) : null;
  return <Modal title={`V${revision.version} · ${revision.action}`} eyebrow="历史版本只读 · 不覆盖当前数据" wide onClose={onClose}>
    <p>{revision.actorName} · {formatDateTime(revision.createdAt)} · {sheetStatusLabels[revision.status]} · {revision.progress}% · 计划 {revision.plannedDate}</p>
    <p>变更原因：{revision.reason || "未记录"}</p>
    <p>操作时间按北京时间显示；历史字段原值可展开查看。人员仅有标识时保留标识，不按当前人员资料反推历史姓名。</p>
    {loaded && ["verification", "quality_inspection"].includes(revision.sheetCode) && <section>
      <h3>本版本放行原件核验</h3>
      {originalChecks ? <><p>当时核验 {originalChecks.length} 份原件的存在性与大小。此记录不代表文件现在仍在，不是内容签章或病毒检查。</p>
        <div style={{ overflowX: "auto" }}><table className="npd2-table"><thead><tr><th>原件名称</th><th>字节数</th><th>核验时间</th><th>存储校验标识</th></tr></thead>
          <tbody>{originalChecks.map((item) => <tr key={item.documentId}><td>{item.fileName}</td><td>{item.size}</td>
            <td>{formatDateTime(item.checkedAt)}</td><td style={{ overflowWrap: "anywhere" }}>{item.etag}</td></tr>)}</tbody></table></div></>
        : <p>此版本未记录完整原件核验凭据，不能据此认定原件齐全或缺失。</p>}
    </section>}
    <label>与历史版本比较 <select value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">仅查看此版本</option>
      {revisions.filter((item) => item.version < revision.version).map((item) => <option key={item.id} value={item.id}>V{item.version} · {item.action}</option>)}
    </select></label>
    {baseline && <table className="npd2-table"><thead><tr><th>阶段记录</th><th>V{baseline.version}</th><th>V{revision.version}</th></tr></thead>
      <tbody><tr><td>状态</td><td>{sheetStatusLabels[baseline.status]}</td><td>{sheetStatusLabels[revision.status]}</td></tr>
        <tr><td>完成度</td><td>{baseline.progress}%</td><td>{revision.progress}%</td></tr>
        <tr><td>计划完成日期</td><td>{baseline.plannedDate}</td><td>{revision.plannedDate}</td></tr>
        <tr><td>操作人 / 时间</td><td>{baseline.actorName} · {formatDateTime(baseline.createdAt)}</td><td>{revision.actorName} · {formatDateTime(revision.createdAt)}</td></tr>
      </tbody></table>}
    {error ? <p role="alert">{error}</p> : !loaded ? <p role="status">正在读取历史内容…</p> : !rows || (compareId && changes === null)
      ? <p className="npd2-stage-note blocked">此版本或对比版本没有完整数据快照，只能查看上述操作元信息，不能据此推断内容差异。</p>
      : compareId ? <><p>{changes!.length} 条领域记录有差异；字段中的版次和时间变化也计入。阶段状态与计划见上表。</p>
        {changes!.map((change) => <details key={change.key}><summary>{change.kind} · {change.label}</summary>
          <div className="npd2-version-compare"><section><h3>对比版本</h3><Values value={change.before} /></section><section><h3>本版本</h3><Values value={change.after} /></section></div>
        </details>)}</> : <><p>此时保存的项目领域数据共 {rows.size} 条，包含表单、规格、零部件、报告、检验和附件索引；不代表完整程序文件归档。</p>
          {[...rows.entries()].map(([key, row]) => <details key={key}><summary>{row.label}</summary><Values value={row.value} /></details>)}</>}
  </Modal>;
}
