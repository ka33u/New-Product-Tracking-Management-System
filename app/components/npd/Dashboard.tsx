"use client";

import { stageAssignment } from "../../../lib/stage-assignment";

import { useMemo, useState } from "react";
import type { DashboardPreference, NpdUser, NpdWorkspaceSnapshot } from "../../../lib/npd-v2";
import { projectStatusLabels } from "../../../lib/npd-v2";
import { buildDashboardModel, businessDate, dashboardMetrics, dashboardPeriod, readDashboardPreference } from "../../../lib/dashboard-model";
import { EmptyState, Icon, Modal, ModalCancelButton, ProgressBar, StatusBadge } from "./ui";

export function Dashboard({ snapshot, currentUser, onOpenProject, onSavePreference }: { snapshot: NpdWorkspaceSnapshot; currentUser: NpdUser; onOpenProject: (id: string) => void; onSavePreference: (value: DashboardPreference) => Promise<void> }) {
  const [preference, setPreference] = useState(() => readDashboardPreference(snapshot.dashboardPreference));
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [showConfig, setShowConfig] = useState(false);
  const [draftMetrics, setDraftMetrics] = useState(preference.visibleMetrics);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const asOf = businessDate();
  const result = useMemo(() => {
    try { return { model: buildDashboardModel(snapshot.projects, preference, ownerFilter, asOf), error: "" }; }
    catch (error) { return { model: null, error: error instanceof Error ? error.message : "统计周期无效。" }; }
  }, [snapshot.projects, preference, ownerFilter, asOf]);
  const model = result.model;
  const projects = model?.projects || [];
  const owners = snapshot.users.filter((user) =>
    snapshot.projects.some((project) => project.ownerId === user.id),
  );
  const values = model?.values || {};
  const statusItems = model?.statusItems || [];
  const colors: Record<string, string> = { active: "#2b70b9", completed: "#1f8a70", paused: "#d59628", draft: "#94a3b8", cancelled: "#c75252" };
  let cursor = 0;
  const conic = statusItems.map((item) => { const from = cursor; cursor += projects.length ? (item.count / projects.length) * 360 : 0; return `${colors[item.status]} ${from}deg ${cursor}deg`; }).join(", ");
  const monthCounts = model?.buckets || [];
  const maxMonth = Math.max(1, ...monthCounts.flatMap((item) => [item.registered, item.completed]));
  const focus = [...projects].sort((a, b) => Number(b.overdueDays > 0) - Number(a.overdueDays > 0) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  const savePreference = async () => {
    if (busy) return;
    setBusy(true); setSaveError("");
    try {
      const next = { ...preference, visibleMetrics: draftMetrics };
      dashboardPeriod(next);
      await onSavePreference(next);
      setPreference(next); setShowConfig(false);
    } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  };

  return <div className="npd2-page">
    <div className="npd2-page-heading">
      <div><span className="npd2-eyebrow">全流程态势</span><h1>项目驾驶舱</h1><p>{currentUser.role === "admin" ? "全公司新品开发项目" : "我发起、负责或参与的项目"} · 所选周期相关项目的当前状态，含跨期未结项目。</p></div>
      <div className="npd2-heading-actions">
        <label className="npd2-owner-filter"><span>项目负责人</span><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">全部负责人</option>{owners.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.roleLabel}</option>)}</select></label>
        <PeriodControl value={preference} onChange={setPreference} />
        <button className="npd2-button npd2-button-soft" onClick={() => { setDraftMetrics([...preference.visibleMetrics]); setSaveError(""); setShowConfig(true); }}><Icon name="settings" />自定义看板</button>
      </div>
    </div>
    {result.error && <p className="npd2-stage-note blocked" role="alert">{result.error} 补全后再显示统计，不会按空结果记为零。</p>}
    {model && <>
      <details className="npd2-dashboard-definitions"><summary>统计口径 · {model.period.start} 至 {model.period.end} · 北京时间</summary>
        <p>卡片、状态分布、项目流量和重点项目共用负责人及项目范围：计划周期与所选区间有交集，另含在该区间内已开始、截至今日仍未关闭的历史项目。不是历史时点快照；暂停不自动顺延交期。</p>
        <p>流量图只统计这些项目在所选区间内的登记、完成日期。登记时间是系统建档时间，不是纸质立项日期；历史补录可能集中在同一天。当前完成数与区间内完成数可能不同。</p>
        <p>逾期按北京时间 {asOf} 判断。数据来自本地工作区；刷新页面读取最新状态。概览导出仍为权限内全部项目，不应用此页筛选。</p>
        <dl>{dashboardMetrics.map(([key, label, , help]) => <div key={key}><dt>{label}</dt><dd>{help}</dd></div>)}</dl>
      </details>
      {(model.invalidPlans > 0 || model.missingCompletionDates > 0 || model.missingRegisteredDates > 0) && <p className="npd2-stage-note blocked" role="status">
        数据待核对：{model.invalidPlans > 0 && (model.invalidPlans + " 个项目计划日期无效，未纳入范围；")}{model.missingCompletionDates > 0 && (model.missingCompletionDates + " 个已完成项目缺少有效实际完成日期，不计按期或完成流量；")}{model.missingRegisteredDates > 0 && (model.missingRegisteredDates + " 个项目登记时间无效或在未来，不计登记流量。")}
      </p>}
      <div className="npd2-metrics">{dashboardMetrics.filter(([key]) => preference.visibleMetrics.includes(key)).map(([key, label, icon, help], index) => <article className={"npd2-metric npd2-metric-" + index % 4} key={key} title={help}>
        <div><span>{label}</span><strong>{values[key] ?? "—"}{key === "averageProgress" && values[key] !== null ? "%" : ""}</strong></div><i><Icon name={icon} /></i><small>{key === "overdue" ? "未关闭且超过计划交期" : key === "onTime" ? "实际完成不晚于计划" : "当前筛选范围"}</small>
      </article>)}</div>
      <div className="npd2-dashboard-grid">
        <article className="npd2-panel npd2-status-panel"><div className="npd2-panel-title"><div><h2>项目状态分布</h2><p>当前状态 · 共 {projects.length} 个项目</p></div></div><div className="npd2-donut-wrap">
          <div className="npd2-donut" aria-hidden="true" style={{ background: projects.length ? "conic-gradient(" + conic + ")" : "#e8edf2" }}><span><b>{projects.length}</b>个项目</span></div>
          <div className="npd2-chart-legend">{statusItems.map((item) => <div key={item.status}><i style={{ background: colors[item.status] }} /><span>{projectStatusLabels[item.status]}</span><b>{item.count}</b></div>)}</div>
        </div></article>
        <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>所选周期项目流量</h2><p>当前筛选项目内 · 登记 {monthCounts.reduce((sum, item) => sum + item.registered, 0)} 个 / 完成 {monthCounts.reduce((sum, item) => sum + item.completed, 0)} 个</p></div><div className="npd2-mini-legend"><span><i className="created" />登记</span><span><i className="done" />完成</span></div></div>
          <div className="npd2-flow-scroll" tabIndex={0} role="region" aria-label="项目流量图，可横向滚动，精确数据见下方明细">
            <div className="npd2-bars npd2-flow-bars">{monthCounts.map((item) => <div className="npd2-bar-column" key={item.start}>
              <div className="npd2-bar-values"><div><b>{item.registered}</b><i className="created" style={{ height: (item.registered / maxMonth * 132) + "px" }} title={item.start + " 至 " + item.end + " 登记 " + item.registered + " 个"} /></div><div><b>{item.completed}</b><i className="done" style={{ height: (item.completed / maxMonth * 132) + "px" }} title={item.start + " 至 " + item.end + " 完成 " + item.completed + " 个"} /></div></div><span>{item.label}</span>
            </div>)}</div>
          </div>
          <details className="npd2-flow-data"><summary>查看流量明细（单位：项目）</summary><div className="npd2-flow-scroll"><table className="npd2-table"><thead><tr><th>起止日期</th><th>登记</th><th>完成</th></tr></thead><tbody>{monthCounts.map((item) => <tr key={item.start}><td>{item.start} 至 {item.end}</td><td>{item.registered}</td><td>{item.completed}</td></tr>)}</tbody></table></div></details>
        </article>
      </div>
      <article className="npd2-panel npd2-focus-panel"><div className="npd2-panel-title"><div><h2>重点项目跟踪</h2><p>未结逾期优先，最多显示 6 个项目；同岗位多位责任人共同列出。</p></div><a className="npd2-link" href="/api/export/projects"><Icon name="export" />导出全部概览</a></div>
        {focus.length === 0 ? <EmptyState title="当前筛选没有项目" detail="请调整负责人或统计周期，现有项目不会被删除。" /> : <div className="npd2-focus-list">{focus.map((project) => {
          const assignment = stageAssignment(snapshot, project.id, project.currentSheetCode);
          return <button key={project.id} onClick={() => onOpenProject(project.id)} className="npd2-focus-row"><div className="npd2-project-mark">{project.seriesName.slice(0, 2)}</div><div className="npd2-project-primary"><strong>{project.name}</strong><span>{project.code} · {project.customerName} · {project.motorCount} 个规格</span></div><div className="npd2-focus-owner"><small>项目负责人</small><b>{project.ownerName}</b></div><StatusBadge value={project.status} label={projectStatusLabels[project.status]} /><div className="npd2-stage"><span><b>{project.currentSheetTitle}</b><em>{assignment.label}</em></span><ProgressBar value={project.progress} /></div><b className={project.overdueDays ? "danger" : ""}>{project.overdueDays ? "逾期 " + project.overdueDays + " 天" : project.progress + "%"}</b><Icon name="arrow" /></button>;
        })}</div>}
      </article>
    </>}
    {showConfig && <Modal protectChanges busy={busy} title="自定义看板" eyebrow="个人显示偏好" onClose={() => { if (!busy) setShowConfig(false); }}>
      {saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}
      <div className="npd2-config-list">{dashboardMetrics.map(([key, label, icon, help]) => <label key={key} title={help}><input type="checkbox" disabled={busy} checked={draftMetrics.includes(key)} onChange={(event) => setDraftMetrics((old) => event.target.checked ? [...old, key] : old.filter((item) => item !== key))} /><span><Icon name={icon} />{label}</span></label>)}</div>
      <div className="npd2-submit-bar"><ModalCancelButton onCancel={() => setShowConfig(false)} busy={busy} /><button className="npd2-button npd2-button-primary" disabled={busy || draftMetrics.length === 0 || !model} onClick={savePreference}>{busy ? "保存中…" : "保存配置"}</button></div>
    </Modal>}
  </div>;
}

function PeriodControl({ value, onChange }: { value: DashboardPreference; onChange: (value: DashboardPreference) => void }) {
  const today = businessDate();
  const currentYear = Number(today.slice(0, 4));
  const selectedYear = Number(value.periodValue.slice(0, 4));
  const years = [...new Set([currentYear - 2, currentYear - 1, currentYear, currentYear + 1, selectedYear].filter((year) => year >= 1000 && year <= 9999))].sort((a, b) => a - b);
  const setMode = (mode: DashboardPreference["periodMode"]) => onChange({ ...value, periodMode: mode,
    periodValue: mode === "month" ? today.slice(0, 7) : mode === "half" ? currentYear + "-H" + (Number(today.slice(5, 7)) <= 6 ? 1 : 2) : String(currentYear),
    customStart: value.customStart || currentYear + "-01-01", customEnd: value.customEnd || currentYear + "-12-31" });
  return <div className="npd2-period"><select aria-label="统计周期类型" value={value.periodMode} onChange={(event) => setMode(event.target.value as DashboardPreference["periodMode"])}><option value="year">年度</option><option value="half">半年度</option><option value="month">月度</option><option value="custom">自定义</option></select>
    {value.periodMode === "year" && <select aria-label="统计年度" value={value.periodValue} onChange={(event) => onChange({ ...value, periodValue: event.target.value })}>{years.map((year) => <option key={year}>{year}</option>)}</select>}
    {value.periodMode === "half" && <select aria-label="统计半年度" value={value.periodValue} onChange={(event) => onChange({ ...value, periodValue: event.target.value })}>{years.flatMap((year) => [<option key={year + "-H1"} value={year + "-H1"}>{year} 上半年</option>, <option key={year + "-H2"} value={year + "-H2"}>{year} 下半年</option>])}</select>}
    {value.periodMode === "month" && <input aria-label="统计月份" type="month" min="1000-01" max="9999-12" value={value.periodValue} onChange={(event) => onChange({ ...value, periodValue: event.target.value })} />}
    {value.periodMode === "custom" && <><input aria-label="统计开始日期" type="date" min="1000-01-01" max="9999-12-31" value={value.customStart} onChange={(event) => onChange({ ...value, customStart: event.target.value })} /><em>至</em><input aria-label="统计结束日期" type="date" min="1000-01-01" max="9999-12-31" value={value.customEnd} onChange={(event) => onChange({ ...value, customEnd: event.target.value })} /></>}
  </div>;
}
