"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NpdProject, NpdSalesOrder, NpdUser, NpdWorkspaceSnapshot } from "../../lib/npd-v2";
import { projectStatusLabels, roleLabels, sheetStatusLabels } from "../../lib/npd-v2";
import { canCreateProject } from "../../lib/access-v2";
import { sheetByCode } from "../../lib/sheets-v2";
import { stageAssignment } from "../../lib/stage-assignment";
import { buildTaskModel } from "../../lib/task-model";
import { businessDate, validBusinessDate } from "../../lib/dashboard-model";
import { NpdAuthenticationRequiredError, writeFailureMessage } from "../../lib/auth-required";
import { WORKSPACE_ACTOR_HEADER, assertWorkspaceIdentity } from "../../lib/workspace-identity";
import { NpdWriteOutcomeUnknownError, requestWorkspaceWrite, savedRefreshNotice, writeErrorNotice, type WriteNotice } from "../../lib/write-feedback";
import { Tasks } from "./npd/Tasks";
import { CreateProjectDialog, CreateUserDialog, LinkOrderDialog, SalesOrderDialog, UserDialog, type UploadFile } from "./npd/Dialogs";
import { Dashboard } from "./npd/Dashboard";
import { ProjectWorkspace } from "./npd/ProjectWorkspace";
import { EmptyState, formatDate, formatDateTime, Icon, ProgressBar, StatusBadge } from "./npd/ui";

import { CustomerDialog, Customers } from "./npd/Customers";
import type { NpdCustomer } from "../../lib/npd-v2";

type View = "dashboard" | "projects" | "orders" | "tasks" | "people" | "customers";

export function NpdWorkspace({ currentUser, initialSnapshot, signOutPath }: { currentUser: NpdUser; initialSnapshot: NpdWorkspaceSnapshot; signOutPath: string }) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [me, setMe] = useState(currentUser);
  const [view, setView] = useState<View>("dashboard");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [linkOrder, setLinkOrder] = useState<NpdSalesOrder | null>(null);
  const [editUser, setEditUser] = useState<NpdUser | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [customerDialog, setCustomerDialog] = useState<{ customer?: NpdCustomer } | null>(null);
  const [toast, setToast] = useState<WriteNotice | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const mobileNavTrigger = useRef<HTMLButtonElement>(null);
  const mobileNavClose = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<number | null>(null);
  useEffect(() => () => { if (toastTimer.current !== null) window.clearTimeout(toastTimer.current); }, []);
  useEffect(() => {
    if (!mobileNav) return;
    const frame = requestAnimationFrame(() => mobileNavClose.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [mobileNav]);
  const closeMobileNav = () => { setMobileNav(false); mobileNavTrigger.current?.focus(); };
  const selectedProject = snapshot.projects.find((project) => project.id === selectedId) || null;
  const taskDate = businessDate();
  const taskModel = useMemo(() => buildTaskModel(snapshot, me, taskDate), [snapshot, me, taskDate]);

  const dismissToast = () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  };
  const notify = (notice: WriteNotice) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(notice);
    if (!notice.persistent) toastTimer.current = window.setTimeout(() => { toastTimer.current = null; setToast(null); }, 4200);
  };
  const refresh = async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    if (response.status === 401) throw new NpdAuthenticationRequiredError();
    const data = await response.json() as { currentUser?: NpdUser; snapshot?: NpdWorkspaceSnapshot; error?: string };
    if (!response.ok || !data.snapshot) throw new Error(data.error || "刷新工作区失败。");
    assertWorkspaceIdentity(me.id, data.currentUser?.id);
    setSnapshot(data.snapshot); if (data.currentUser) setMe(data.currentUser);
  };
  const runAction = async (kind: string, payload: unknown) => {
    try {
      const { response, data } = await requestWorkspaceWrite("/api/action", { method: "POST", headers: { "Content-Type": "application/json", [WORKSPACE_ACTOR_HEADER]: me.id }, body: JSON.stringify({ kind, payload }) });
      if (!response.ok) {
        if (response.status === 409) { try { await refresh(); } catch { /* Keep the user's draft and the conflict explanation. */ } }
        throw new Error(writeFailureMessage(response.status, data.error, "操作失败。"));
      }
      let notice: WriteNotice = { type: "success", message: actionSuccess[kind] || "操作已完成并记录时间戳。" };
      try { await refresh(); } catch (error) { notice = savedRefreshNotice(error); }
      if (kind === "create_project" && data.result && typeof data.result === "object" && "id" in data.result) setSelectedId(String((data.result as { id: string }).id));
      notify(notice);
      return data.result;
    } catch (error) {
      notify(writeErrorNotice(error, "操作失败。"));
      throw error;
    }
  };
  const uploadFile: UploadFile = async (file, options) => {
    try {
      const body = new FormData(); body.set("file", file); body.set("projectId", options.projectId); body.set("sheetCode", options.sheetCode); body.set("kind", options.kind); if (options.motorId) body.set("motorId", options.motorId);
      const { response, data } = await requestWorkspaceWrite("/api/files", { method: "POST", headers: { [WORKSPACE_ACTOR_HEADER]: me.id }, body });
      if (!response.ok) throw new Error(writeFailureMessage(response.status, data.error, "附件上传失败。"));
      if (typeof data.id !== "string" || !data.id) throw new NpdWriteOutcomeUnknownError();
      let notice: WriteNotice = { type: "success", message: `附件“${file.name}”已上传并记录时间戳。` };
      try { await refresh(); } catch (error) { notice = savedRefreshNotice(error, true); }
      notify(notice);
      return data.id;
    } catch (error) { notify(writeErrorNotice(error, "附件上传失败。")); throw error; }
  };
  const navigate = (next: View) => { setView(next); setSelectedId(null); if (mobileNav) closeMobileNav(); };

  if (selectedProject) return <><ProjectWorkspace project={selectedProject} snapshot={snapshot} currentUser={me} signOutPath={signOutPath} onBack={() => setSelectedId(null)} onAction={runAction} onUpload={uploadFile} />{toast && <Toast {...toast} onDismiss={dismissToast} />}</>;

  return <div className="npd2-app" onKeyDown={(event) => { if (event.key === "Escape" && mobileNav) { event.preventDefault(); closeMobileNav(); } }}>
    <aside id="npd-sidebar" className={`npd2-sidebar ${mobileNav ? "open" : ""}`} onKeyDown={(event) => { if (event.key === "Escape" && mobileNav) { event.preventDefault(); closeMobileNav(); } }}><button ref={mobileNavClose} className="npd2-nav-close" onClick={closeMobileNav}><Icon name="close" />关闭导航</button><div className="npd2-brand"><div className="npd2-brand-symbol"><span>H</span><i /></div><div><b>亨达新品开发</b><small>全流程监控系统</small></div></div><nav><NavButton icon="grid" label="项目看板" active={view === "dashboard"} onClick={() => navigate("dashboard")} /><NavButton icon="folder" label="新品项目" count={snapshot.projects.length} active={view === "projects"} onClick={() => navigate("projects")} /><NavButton icon="link" label="销售订单" count={snapshot.orders.filter((order) => !order.projectId).length} active={view === "orders"} onClick={() => navigate("orders")} />{["admin", "sales"].includes(me.role) && <NavButton icon="users" label="客户资料" active={view === "customers"} onClick={() => navigate("customers")} />}<NavButton icon="task" label="我的任务" count={taskModel.pending.length} active={view === "tasks"} onClick={() => navigate("tasks")} />{me.role === "admin" && <NavButton icon="users" label="人员权限" count={snapshot.users.filter((user) => user.active).length} active={view === "people"} onClick={() => navigate("people")} />}</nav><div className="npd2-sidebar-guide"><span><Icon name="shield" /></span><b>阶段门禁已启用</b><p>前置交付不齐套时，系统会阻止阶段放行和项目完成。</p></div><div className="npd2-sidebar-user"><span>{me.avatar}</span><div><b>{me.name}</b><small>{me.roleLabel} · {me.department}</small></div>{signOutPath === "/api/local-auth/logout" ? <form action={signOutPath} method="post"><button type="submit" title="退出当前账户"><Icon name="exit" />退出</button></form> : <a href={signOutPath} title="退出当前账户"><Icon name="exit" />退出</a>}</div></aside>
    <div className="npd2-main"><header className="npd2-topbar"><button ref={mobileNavTrigger} className="npd2-menu-button" aria-label={mobileNav ? "关闭导航" : "打开导航"} aria-expanded={mobileNav} aria-controls="npd-sidebar" onClick={() => mobileNav ? closeMobileNav() : setMobileNav(true)}><Icon name="menu" /></button><div className="npd2-search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、订单、客户或电机型号…" /></div><div className="npd2-top-actions"><span className="npd2-scope"><Icon name="shield" />{me.role === "admin" ? "全局数据范围" : "发起 / 负责 / 参与项目"}</span>{canCreateProject(me.role) && <button className="npd2-button npd2-button-primary" onClick={() => setCreateOpen(true)}><Icon name="plus" />创建新项目</button>}</div></header><main>{view === "customers" && ["admin", "sales"].includes(me.role) && <Customers customers={snapshot.customers} query={query} onEdit={(customer) => setCustomerDialog({ customer })} onCreate={() => setCustomerDialog({})} />}{view === "dashboard" && <Dashboard snapshot={snapshot} currentUser={me} onOpenProject={setSelectedId} onSavePreference={async (value) => { await runAction("save_dashboard_preference", value); }} />}{view === "projects" && <Projects snapshot={snapshot} query={query} onOpen={setSelectedId} onCreate={() => setCreateOpen(true)} canCreate={canCreateProject(me.role)} />}{view === "orders" && <Orders snapshot={snapshot} currentUser={me} query={query} onCreate={() => setOrderOpen(true)} onLink={setLinkOrder} onOpenProject={setSelectedId} />}{view === "tasks" && <Tasks model={taskModel} onOpen={setSelectedId} />}{view === "people" && me.role === "admin" && <People users={snapshot.users} query={query} onEdit={setEditUser} onCreate={() => setCreateUserOpen(true)} />}</main></div>
    {createOpen && <CreateProjectDialog snapshot={snapshot} onClose={() => setCreateOpen(false)} onAction={runAction} />}
    {orderOpen && <SalesOrderDialog snapshot={snapshot} onClose={() => setOrderOpen(false)} onAction={runAction} />}
    {linkOrder && <LinkOrderDialog order={linkOrder} snapshot={snapshot} onClose={() => setLinkOrder(null)} onAction={runAction} />}
    {createUserOpen && <CreateUserDialog localAuth={signOutPath === "/api/local-auth/logout"} onClose={() => setCreateUserOpen(false)} onAction={runAction} />}
    {customerDialog && <CustomerDialog customer={customerDialog.customer} onClose={() => setCustomerDialog(null)} onAction={runAction} />}
    {editUser && <UserDialog user={editUser} onClose={() => setEditUser(null)} onAction={runAction} />}
    {toast && <Toast {...toast} onDismiss={dismissToast} />}
  </div>;
}

const actionSuccess: Record<string, string> = {
  save_customer: "客户资料已保存并记录变更。",
  create_project: "新品项目已创建，10 个阶段 Sheet 已生成。", add_motor: "电机规格已加入项目。",
  update_motor: "电机规格已生成新设计版次，下游影响已重新复核。",
  create_order: "销售订单已录入台账。", link_order: "订单与新品项目的关联已更新。",
  update_motor_requirements: "设计输出的检验、试验要求已更新。", save_form: "受控表单已保存。",
  update_sheet: "阶段状态已更新。", add_part: "零部件与节点已加入。", confirm_part: "生产节点已确认。", confirm_motor: "整机生产节点已确认，版本和阶段进度已同步。",
  update_part: "零部件已生成新设计版次，原确认记录已保留。",
  create_test_report: "试验报告已提交。", create_inspection: "质量检验记录已提交。",
  assign_member: "项目成员职责已更新。", set_project_status: "项目运行状态已变更。",
  create_user: "登录账户已创建。", update_user: "人员账户与权限已更新。", save_dashboard_preference: "个人看板配置已保存。",
};

function NavButton({ icon, label, count, active, onClick }: { icon: string; label: string; count?: number; active: boolean; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><Icon name={icon} /><span>{label}</span>{count !== undefined && <em>{count}</em>}</button>;
}

function Projects({ snapshot, query, onOpen, onCreate, canCreate }: { snapshot: NpdWorkspaceSnapshot; query: string; onOpen: (id: string) => void; onCreate: () => void; canCreate: boolean }) {
  const [status, setStatus] = useState("all");
  const [mode, setMode] = useState<"table" | "cards">("table");
  const motorProjectIds = new Set(snapshot.motors.filter((motor) => motor.model.toLowerCase().includes(query.toLowerCase())).map((motor) => motor.projectId));
  const projects = snapshot.projects.filter((project) => (status === "all" || project.status === status) && (!query || [project.code, project.name, project.seriesName, project.customerName, project.ownerName].some((value) => value.toLowerCase().includes(query.toLowerCase())) || motorProjectIds.has(project.id)));
  return <div className="npd2-page">
    <div className="npd2-page-heading"><div><span className="npd2-eyebrow">项目组合</span><h1>新品项目</h1><p>负责人、阶段责任人、状态与总体进度按同一开发节点对齐展示。</p></div><div className="npd2-heading-actions"><a className="npd2-button npd2-button-soft" href="/api/export/projects"><Icon name="export" />导出项目概览</a>{canCreate && <button className="npd2-button npd2-button-primary" onClick={onCreate}><Icon name="plus" />创建新项目</button>}</div></div>
    <div className="npd2-filterbar"><div className="npd2-filter-tabs">{[["all", "全部"], ["active", "进行中"], ["completed", "已完成"], ["paused", "已暂停"], ["cancelled", "已终止"]].map(([value, label]) => <button key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{label}<span>{value === "all" ? snapshot.projects.length : snapshot.projects.filter((item) => item.status === value).length}</span></button>)}</div><div className="npd2-view-switch"><button className={mode === "table" ? "active" : ""} onClick={() => setMode("table")} aria-label="表格视图"><Icon name="task" /></button><button className={mode === "cards" ? "active" : ""} onClick={() => setMode("cards")} aria-label="卡片视图"><Icon name="grid" /></button></div></div>
    {projects.length === 0 ? <EmptyState title="没有匹配的新品项目" detail="调整搜索或筛选条件后再试。" /> : mode === "table" ? <div className="npd2-panel npd2-project-table-wrap"><table className="npd2-table npd2-project-table"><thead><tr><th>项目</th><th>客户</th><th>项目负责人</th><th>电机规格</th><th>当前进度节点</th><th>计划完成</th><th>项目状态</th><th /></tr></thead><tbody>{projects.map((project) => {
      const context = projectStageContext(snapshot, project);
      return <tr key={project.id} onClick={() => onOpen(project.id)}><td><div className="npd2-table-project"><span>{project.seriesName.slice(0, 2)}</span><div><b>{project.name}</b><small>{project.code} · {project.seriesName}</small></div></div></td><td><b>{project.customerName}</b><span>{project.initiatorName} 发起</span></td><td><div className="npd2-owner-cell"><span className="npd2-avatar">{initials(project.ownerName)}</span><div><b>{project.ownerName}</b><small>{context.owner?.roleLabel || "项目负责人"}</small></div></div></td><td><b>{project.motorCount} 个规格</b><span>{snapshot.motors.filter((motor) => motor.projectId === project.id).slice(0, 2).map((motor) => motor.model).join("、")}</span></td><td><ProjectProgressNode project={project} context={context} /></td><td className={project.overdueDays ? "npd2-danger-cell" : ""}>{project.plannedEnd}<span>{project.overdueDays ? `逾期 ${project.overdueDays} 天` : "计划内"}</span></td><td><StatusBadge value={project.status} label={projectStatusLabels[project.status]} /></td><td><Icon name="arrow" /></td></tr>;
    })}</tbody></table></div> : <div className="npd2-project-cards">{projects.map((project) => {
      const context = projectStageContext(snapshot, project);
      return <button key={project.id} onClick={() => onOpen(project.id)}><header><span>{project.seriesName.slice(0, 2)}</span><StatusBadge value={project.status} label={projectStatusLabels[project.status]} /></header><small>{project.code}</small><h2>{project.name}</h2><p>{project.customerName} · {project.motorCount} 个规格</p><div className="npd2-card-ownership"><span><small>项目负责人</small><b>{project.ownerName}</b></span><span><small>当前节点责任人</small><b>{context.assignment.label}</b></span></div><div className="npd2-card-node"><span><small>Sheet {context.definition.index}/10</small><b>{context.definition.shortTitle}</b></span><StatusBadge value={context.sheet?.status || "not_started"} label={context.sheet ? sheetStatusLabels[context.sheet.status] : "未开始"} /></div><footer><ProgressBar value={project.progress} /><b>{project.progress}%</b></footer></button>;
    })}</div>}
  </div>;
}

function projectStageContext(snapshot: NpdWorkspaceSnapshot, project: NpdProject) {
  const definition = sheetByCode[project.currentSheetCode];
  const sheet = snapshot.sheets.find((item) => item.projectId === project.id && item.code === project.currentSheetCode);
  const assignment = stageAssignment(snapshot, project.id, project.currentSheetCode);
  const owner = snapshot.users.find((user) => user.id === project.ownerId);
  return { definition, sheet, assignment, owner };
}

function ProjectProgressNode({ project, context }: { project: NpdProject; context: ReturnType<typeof projectStageContext> }) {
  const status = context.sheet?.status || "not_started";
  return <div className="npd2-node-cell"><div className="npd2-node-head"><b>Sheet {context.definition.index}/10 · {context.definition.shortTitle}</b><StatusBadge value={status} label={context.sheet ? sheetStatusLabels[context.sheet.status] : "未开始"} /></div><span>{context.assignment.label} · {context.assignment.roleLabel}</span><div className="npd2-node-progress"><ProgressBar value={project.progress} /><strong>{project.progress}%</strong></div></div>;
}

function initials(name: string) {
  return name.trim().slice(-2) || "员";
}

function Orders({ snapshot, currentUser, query, onCreate, onLink, onOpenProject }: { snapshot: NpdWorkspaceSnapshot; currentUser: NpdUser; query: string; onCreate: () => void; onLink: (order: NpdSalesOrder) => void; onOpenProject: (id: string) => void }) {
  const [filter, setFilter] = useState<"all" | "unlinked" | "linked">("all");
  const canManage = currentUser.role === "admin" || currentUser.role === "sales";
  const asOf = businessDate();
  const orders = snapshot.orders.filter((order) =>
    (filter === "all" || (filter === "linked" ? Boolean(order.projectId) : !order.projectId)) &&
    (!query || [order.orderNo, order.customerName, order.productSummary, order.projectCode].some((value) => value.toLowerCase().includes(query.toLowerCase()))),
  );
  const amount = orders.reduce((sum, order) => sum + (order.currency === "CNY" ? order.amount : 0), 0);
  return <div className="npd2-page"><div className="npd2-page-heading"><div><span className="npd2-eyebrow">销售与研发衔接</span><h1>销售订单</h1><p>销售订单与新品项目建立正式关联；一个项目可承接多个同客户订单，交付日期进入项目跟踪视野。</p></div>{canManage && <button className="npd2-button npd2-button-primary" onClick={onCreate}><Icon name="plus" />录入销售订单</button>}</div><div className="npd2-task-summary"><span><Icon name="link" /><div><b>{snapshot.orders.length}</b><small>订单总数</small></div></span><span><Icon name="alert" /><div><b>{snapshot.orders.filter((order) => !order.projectId).length}</b><small>待关联项目</small></div></span><span><Icon name="chart" /><div><b>{(amount / 10000).toFixed(1)}万</b><small>当前筛选人民币金额</small></div></span></div><div className="npd2-filterbar"><div className="npd2-filter-tabs">{[["all", "全部订单"], ["unlinked", "待关联"], ["linked", "已关联"]].map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value as typeof filter)}>{label}</button>)}</div></div><article className="npd2-panel npd2-project-table-wrap">{orders.length ? <table className="npd2-table npd2-order-table"><thead><tr><th>订单号 / 客户</th><th>产品概要</th><th>数量 / 金额</th><th>订单日期</th><th>计划交付</th><th>关联新品项目</th><th>状态</th><th>操作</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><b>{order.orderNo}</b><span>{order.customerName}</span></td><td><b>{order.productSummary}</b><span>{order.createdByName} 录入</span></td><td><b>{order.quantity} 台</b><span>{order.currency} {order.amount.toLocaleString("zh-CN")}</span></td><td>{order.orderDate}</td><td className={validBusinessDate(order.deliveryDate) && order.deliveryDate < asOf && order.status !== "completed" ? "npd2-danger-cell" : ""}>{validBusinessDate(order.deliveryDate) ? order.deliveryDate : <span title="未设置或不是有效日历日期，请核对原始订单资料。">日期待核对{order.deliveryDate ? `（${order.deliveryDate}）` : ""}</span>}</td><td>{order.projectId ? <button className="npd2-order-project" onClick={() => onOpenProject(order.projectId!)}><Icon name="folder" />{order.projectCode}<Icon name="arrow" /></button> : <StatusBadge value="not_started" label="待关联" />}</td><td><StatusBadge value={order.status === "completed" ? "completed" : order.projectId ? "active" : "pending_review"} label={order.status === "completed" ? "已完成" : order.projectId ? "开发中" : "已确认"} /></td><td>{canManage && <button className="npd2-button npd2-button-soft" onClick={() => onLink(order)}><Icon name="link" />维护关联</button>}</td></tr>)}</tbody></table> : <EmptyState icon="link" title="没有匹配的销售订单" detail="调整筛选条件，或由销售录入新的订单。" />}</article></div>;
}

function People({ users, query, onEdit, onCreate }: { users: NpdUser[]; query: string; onEdit: (user: NpdUser) => void; onCreate: () => void }) {
  const [accountStatus, setAccountStatus] = useState<"all" | "active" | "inactive">("all");
  const visible = users.filter((user) =>
    (accountStatus === "all" || (accountStatus === "active" ? user.active : !user.active)) &&
    (!query || [user.name, user.email, user.department, user.roleLabel].some((value) => value.toLowerCase().includes(query.toLowerCase()))),
  );
  return <div className="npd2-page">
    <div className="npd2-page-heading"><div><span className="npd2-eyebrow">访问控制</span><h1>人员与权限</h1><p>账户按登录邮箱识别；支持新建、资料维护、角色授权、启用和停用，全程保留时间戳。</p></div><button className="npd2-button npd2-button-primary" onClick={onCreate}><Icon name="plus" />新建账户</button></div>
    <div className="npd2-role-cards">{Object.entries(roleLabels).map(([role, label]) => <div key={role}><span><Icon name={role === "admin" ? "shield" : role === "production" ? "settings" : role === "tester" || role === "quality" ? "file" : "users"} /></span><div><b>{label}</b><small>{users.filter((user) => user.role === role && user.active).length} 个有效账号</small></div></div>)}</div>
    <div className="npd2-people-summary"><span><b>{users.length}</b><small>账户总数</small></span><span><b>{users.filter((user) => user.active).length}</b><small>有效账户</small></span><span><b>{users.filter((user) => !user.active).length}</b><small>已停用</small></span><span><b>{users.filter((user) => user.role === "admin" && user.active).length}</b><small>有效管理员</small></span></div>
    <div className="npd2-filterbar"><div className="npd2-filter-tabs">{[["all", "全部账户"], ["active", "有效"], ["inactive", "已停用"]].map(([value, label]) => <button key={value} className={accountStatus === value ? "active" : ""} onClick={() => setAccountStatus(value as typeof accountStatus)}>{label}<span>{value === "all" ? users.length : users.filter((user) => value === "active" ? user.active : !user.active).length}</span></button>)}</div></div>
    <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>登录账户</h2><p>只有管理员可维护；至少保留一名有效管理员，停用代替删除以保护历史记录。</p></div></div>{visible.length ? <div className="npd2-people-list">{visible.map((user) => <div key={user.id}><span className="npd2-avatar">{user.avatar}</span><div className="npd2-person-main"><b>{user.name}{!user.active && <em>已停用</em>}</b><small>{user.email}</small></div><div><small>登录类型</small><StatusBadge value={user.role} label={user.roleLabel} /></div><div><small>所属部门</small><b>{user.department}</b></div><div><small>账号状态</small><b className={user.active ? "npd2-active-text" : "npd2-muted-text"}>{user.active ? "有效" : "停用"}</b><span title={`更新时间（北京时间）：${formatDateTime(user.updatedAt)}`}>更新 {formatDate(user.updatedAt)}</span></div><button className="npd2-button npd2-button-soft" onClick={() => onEdit(user)}><Icon name="edit" />维护账户</button></div>)}</div> : <EmptyState icon="users" title="没有匹配的账户" detail="调整搜索或账号状态筛选后再试。" />}</article>
  </div>;
}

function Toast({ type, title, message, onDismiss }: WriteNotice & { onDismiss: () => void }) {
  return <div className={`npd2-toast ${type}`} role={type === "success" ? "status" : "alert"} aria-atomic="true"><span aria-hidden="true"><Icon name={type === "success" ? "check" : "alert"} /></span><div><b>{title || (type === "success" ? "操作成功" : "未能完成")}</b><p>{message}</p></div><button type="button" className="npd2-toast-close" aria-label="关闭提示" onClick={onDismiss}><Icon name="close" /></button></div>;
}
