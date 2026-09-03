"use client";

import { useMemo, useState } from "react";
import type { DashboardPreference, NpdUser, NpdWorkspaceSnapshot } from "../../../lib/npd-v2";
import { projectStatusLabels } from "../../../lib/npd-v2";
import { Icon, Modal, ProgressBar, StatusBadge } from "./ui";

const metricDefinitions = [
  ["total", "项目总数", "folder"], ["active", "进行中", "chart"],
  ["completed", "已完成", "check"], ["onTime", "按期项目", "clock"],
  ["overdue", "逾期项目", "alert"], ["motors", "电机规格", "motor"],
  ["averageProgress", "平均进度", "chart"], ["highRisk", "高风险", "shield"],
] as const;

function periodBounds(preference: DashboardPreference) {
  const now = new Date();
  const year = Number(preference.periodValue.slice(0, 4)) || now.getFullYear();
  if (preference.periodMode === "custom") return [preference.customStart || "0000-01-01", preference.customEnd || "9999-12-31"];
  if (preference.periodMode === "month") {
    const month = /^\d{4}-\d{2}$/.test(preference.periodValue) ? preference.periodValue : now.toISOString().slice(0, 7);
    const end = new Date(`${month}-01T00:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    return [`${month}-01`, end.toISOString().slice(0, 10)];
  }
  if (preference.periodMode === "half") {
    const second = preference.periodValue.endsWith("H2");
    return [`${year}-${second ? "07" : "01"}-01`, `${year}-${second ? "12-31" : "06-30"}`];
  }
  return [`${year}-01-01`, `${year}-12-31`];
}

export function Dashboard({ snapshot, currentUser, onOpenProject, onSavePreference }: { snapshot: NpdWorkspaceSnapshot; currentUser: NpdUser; onOpenProject: (id: string) => void; onSavePreference: (value: DashboardPreference) => Promise<void> }) {
  const [preference, setPreference] = useState(snapshot.dashboardPreference);
  const [showConfig, setShowConfig] = useState(false);
  const [busy, setBusy] = useState(false);
  const projects = useMemo(() => {
    const [start, end] = periodBounds(preference);
    return snapshot.projects.filter((project) => project.plannedStart <= end && project.plannedEnd >= start);
  }, [snapshot.projects, preference]);
  const values: Record<string, number> = {
    total: projects.length,
    active: projects.filter((item) => item.status === "active").length,
    completed: projects.filter((item) => item.status === "completed").length,
    onTime: projects.filter((item) => item.overdueDays === 0 && item.status !== "cancelled").length,
    overdue: projects.filter((item) => item.overdueDays > 0).length,
    motors: projects.reduce((sum, item) => sum + item.motorCount, 0),
    averageProgress: projects.length ? Math.round(projects.reduce((sum, item) => sum + item.progress, 0) / projects.length) : 0,
    highRisk: projects.filter((item) => item.riskLevel === "high" || item.riskLevel === "critical").length,
  };
  const statusItems = ["active", "completed", "paused", "draft", "cancelled"].map((status) => ({ status, count: projects.filter((item) => item.status === status).length }));
  const colors: Record<string, string> = { active: "#2b70b9", completed: "#1f8a70", paused: "#d59628", draft: "#94a3b8", cancelled: "#c75252" };
  let cursor = 0;
  const conic = statusItems.map((item) => { const from = cursor; cursor += projects.length ? (item.count / projects.length) * 360 : 0; return `${colors[item.status]} ${from}deg ${cursor}deg`; }).join(", ");
  const monthCounts = useMemo(() => {
    const months: { key: string; label: string; created: number; completed: number }[] = [];
    const base = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(base.getFullYear(), base.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      months.push({ key, label: `${date.getMonth() + 1}月`, created: snapshot.projects.filter((item) => item.createdAt.startsWith(key)).length, completed: snapshot.projects.filter((item) => item.actualEnd?.startsWith(key)).length });
    }
    return months;
  }, [snapshot.projects]);
  const maxMonth = Math.max(1, ...monthCounts.flatMap((item) => [item.created, item.completed]));
  const focus = [...projects].sort((a, b) => Number(b.overdueDays > 0) - Number(a.overdueDays > 0) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);

  const savePreference = async () => {
    setBusy(true);
    try { await onSavePreference(preference); setShowConfig(false); } finally { setBusy(false); }
  };

  return <div className="npd2-page">
    <div className="npd2-page-heading"><div><span className="npd2-eyebrow">全流程态势</span><h1>项目驾驶舱</h1><p>{currentUser.role === "admin" ? "全公司新品开发项目" : "我发起、负责或参与的项目"}，统计周期可按年、半年、月度或自定义区间切换。</p></div><div className="npd2-heading-actions"><PeriodControl value={preference} onChange={setPreference} /><button className="npd2-button npd2-button-soft" onClick={() => setShowConfig(true)}><Icon name="settings" />自定义看板</button></div></div>
    <div className="npd2-metrics">{metricDefinitions.filter(([key]) => preference.visibleMetrics.includes(key)).map(([key, label, icon], index) => <article className={`npd2-metric npd2-metric-${index % 4}`} key={key}><div><span>{label}</span><strong>{values[key]}{key === "averageProgress" ? "%" : ""}</strong></div><i><Icon name={icon} /></i><small>{key === "overdue" && values[key] ? "需要立即跟进" : key === "completed" ? "已形成闭环" : "当前统计周期"}</small></article>)}</div>
    <div className="npd2-dashboard-grid">
      <article className="npd2-panel npd2-status-panel"><div className="npd2-panel-title"><div><h2>项目状态分布</h2><p>按项目当前生命周期状态统计</p></div></div><div className="npd2-donut-wrap"><div className="npd2-donut" style={{ background: projects.length ? `conic-gradient(${conic})` : "#e8edf2" }}><span><b>{projects.length}</b>个项目</span></div><div className="npd2-chart-legend">{statusItems.map((item) => <div key={item.status}><i style={{ background: colors[item.status] }} /><span>{projectStatusLabels[item.status as keyof typeof projectStatusLabels]}</span><b>{item.count}</b></div>)}</div></div></article>
      <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>近 6 月项目流量</h2><p>新立项与已完成项目趋势</p></div><div className="npd2-mini-legend"><span><i className="created" />新立项</span><span><i className="done" />已完成</span></div></div><div className="npd2-bars">{monthCounts.map((item) => <div className="npd2-bar-column" key={item.key}><div className="npd2-bar-values"><i className="created" style={{ height: `${Math.max(4, item.created / maxMonth * 132)}px` }} title={`新立项 ${item.created}`} /><i className="done" style={{ height: `${Math.max(4, item.completed / maxMonth * 132)}px` }} title={`已完成 ${item.completed}`} /></div><span>{item.label}</span></div>)}</div></article>
    </div>
    <article className="npd2-panel npd2-focus-panel"><div className="npd2-panel-title"><div><h2>重点项目跟踪</h2><p>项目负责人、节点责任人、阶段状态与进度同步对齐</p></div><a className="npd2-link" href="/api/export/projects"><Icon name="export" />导出概览</a></div><div className="npd2-focus-list">{focus.map((project) => {
      const sheet = snapshot.sheets.find((item) => item.projectId === project.id && item.code === project.currentSheetCode);
      const stageOwner = snapshot.members.find((member) => member.projectId === project.id && member.role === sheet?.ownerRole);
      return <button key={project.id} onClick={() => onOpenProject(project.id)} className="npd2-focus-row"><div className="npd2-project-mark">{project.seriesName.slice(0, 2)}</div><div className="npd2-project-primary"><strong>{project.name}</strong><span>{project.code} · {project.customerName} · {project.motorCount} 个规格</span></div><div className="npd2-focus-owner"><small>项目负责人</small><b>{project.ownerName}</b></div><StatusBadge value={project.status} label={projectStatusLabels[project.status]} /><div className="npd2-stage"><span><b>{project.currentSheetTitle}</b><em>{stageOwner?.userName || sheet?.ownerRoleLabel || "待分配"}</em></span><ProgressBar value={project.progress} /></div><b className={project.overdueDays ? "danger" : ""}>{project.overdueDays ? `逾期 ${project.overdueDays} 天` : `${project.progress}%`}</b><Icon name="arrow" /></button>;
    })}</div></article>
    {showConfig && <Modal title="自定义看板" eyebrow="个人显示偏好" onClose={() => setShowConfig(false)}><div className="npd2-config-list">{metricDefinitions.map(([key, label, icon]) => <label key={key}><input type="checkbox" checked={preference.visibleMetrics.includes(key)} onChange={(event) => setPreference((old) => ({ ...old, visibleMetrics: event.target.checked ? [...old.visibleMetrics, key] : old.visibleMetrics.filter((item) => item !== key) }))} /><span><Icon name={icon} />{label}</span></label>)}</div><div className="npd2-submit-bar"><button className="npd2-button npd2-button-ghost" onClick={() => setShowConfig(false)}>取消</button><button className="npd2-button npd2-button-primary" disabled={busy || preference.visibleMetrics.length === 0} onClick={savePreference}>{busy ? "保存中…" : "保存配置"}</button></div></Modal>}
  </div>;
}

function PeriodControl({ value, onChange }: { value: DashboardPreference; onChange: (value: DashboardPreference) => void }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const setMode = (mode: DashboardPreference["periodMode"]) => onChange({ ...value, periodMode: mode, periodValue: mode === "month" ? now.toISOString().slice(0, 7) : mode === "half" ? `${currentYear}-H1` : String(currentYear) });
  return <div className="npd2-period"><select value={value.periodMode} onChange={(event) => setMode(event.target.value as DashboardPreference["periodMode"])}><option value="year">年度</option><option value="half">半年度</option><option value="month">月度</option><option value="custom">自定义</option></select>{value.periodMode === "year" && <select value={value.periodValue} onChange={(event) => onChange({ ...value, periodValue: event.target.value })}>{[currentYear - 2, currentYear - 1, currentYear, currentYear + 1].map((year) => <option key={year}>{year}</option>)}</select>}{value.periodMode === "half" && <select value={value.periodValue} onChange={(event) => onChange({ ...value, periodValue: event.target.value })}>{[currentYear - 1, currentYear, currentYear + 1].flatMap((year) => [<option key={`${year}-H1`} value={`${year}-H1`}>{year} 上半年</option>, <option key={`${year}-H2`} value={`${year}-H2`}>{year} 下半年</option>])}</select>}{value.periodMode === "month" && <input type="month" value={value.periodValue} onChange={(event) => onChange({ ...value, periodValue: event.target.value })} />}{value.periodMode === "custom" && <><input type="date" value={value.customStart} onChange={(event) => onChange({ ...value, customStart: event.target.value })} /><em>至</em><input type="date" value={value.customEnd} onChange={(event) => onChange({ ...value, customEnd: event.target.value })} /></>}</div>;
}
