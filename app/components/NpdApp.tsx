"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  Approval,
  ChangeRequest,
  CurrentUser,
  FormRecord,
  Issue,
  Milestone,
  Project,
  RiskLevel,
  SalesOrder,
  UserRecord,
  WorkspaceSnapshot,
} from "../../lib/domain";
import { formDefinitions, type FormDefinition } from "../../lib/forms";
import {
  permissionsByRole,
  roleLabels,
  type Permission,
} from "../../lib/permissions";

type ViewKey =
  | "dashboard"
  | "projects"
  | "orders"
  | "forms"
  | "approvals"
  | "changes"
  | "reports"
  | "admin";

interface NpdAppProps {
  currentUser: CurrentUser;
  initialSnapshot: WorkspaceSnapshot;
  permissions: Permission[];
}

const navigation: Array<{
  key: ViewKey;
  label: string;
  glyph: string;
  permission?: Permission;
}> = [
  { key: "dashboard", label: "工作台", glyph: "⌂" },
  { key: "projects", label: "新品项目", glyph: "项" },
  { key: "orders", label: "订单关联", glyph: "单", permission: "order:view" },
  { key: "forms", label: "表单中心", glyph: "表" },
  { key: "approvals", label: "我的审批", glyph: "审" },
  { key: "changes", label: "变更控制", glyph: "变" },
  { key: "reports", label: "进度与分析", glyph: "析", permission: "report:view" },
  { key: "admin", label: "人员与权限", glyph: "权", permission: "user:manage" },
];

const gateOrder = [
  "initiation",
  "planning",
  "input_review",
  "design_output",
  "design_review",
  "verification",
  "confirmation",
  "release",
  "change",
];

const gateLabels: Record<string, string> = {
  initiation: "立项",
  planning: "策划",
  input_review: "输入评审",
  design_output: "设计输出",
  design_review: "输出评审",
  verification: "验证",
  confirmation: "确认",
  release: "定型",
  change: "变更归档",
};

const riskLabels: Record<RiskLevel, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  critical: "严重",
};

const statusLabels: Record<string, string> = {
  planning: "立项中",
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已终止",
  confirmed: "已确认",
  technical_review: "技术评审",
  in_production: "生产中",
  pending: "待审批",
  approved: "已批准",
  rejected: "已退回",
  draft: "草稿",
  under_review: "评审中",
  verified: "已验证归档",
  open: "待解决",
  closed: "已关闭",
  not_started: "未开始",
  in_progress: "进行中",
  blocked: "受阻",
  waived: "已裁剪",
  submitted: "已提交",
};

export function NpdApp({
  currentUser,
  initialSnapshot,
  permissions,
}: NpdAppProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [projectDrawerId, setProjectDrawerId] = useState<string | null>(null);
  const [projectTab, setProjectTab] = useState("overview");
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [orderLinkDialog, setOrderLinkDialog] = useState<SalesOrder | null>(null);
  const [formEditor, setFormEditor] = useState<{
    projectId: string;
    definition: FormDefinition;
  } | null>(null);
  const [changeEditorOpen, setChangeEditorOpen] = useState(false);
  const [approvalDialog, setApprovalDialog] = useState<{
    approval: Approval;
    decision: "approved" | "rejected";
  } | null>(null);
  const [changeDecisionDialog, setChangeDecisionDialog] = useState<{
    change: ChangeRequest;
    decision: "approved" | "rejected";
  } | null>(null);
  const [changeVerifyDialog, setChangeVerifyDialog] =
    useState<ChangeRequest | null>(null);
  const [milestoneDialog, setMilestoneDialog] = useState<Milestone | null>(null);
  const [waiveMilestoneDialog, setWaiveMilestoneDialog] =
    useState<Milestone | null>(null);
  const [issueCreateProject, setIssueCreateProject] = useState<Project | null>(
    null,
  );
  const [projectStatusDialog, setProjectStatusDialog] = useState<{
    project: Project;
    mode: "pause" | "resume" | "terminate";
  } | null>(null);
  const [issueDialog, setIssueDialog] = useState<Issue | null>(null);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const can = (permission: Permission) => permissions.includes(permission);
  const canDecideApproval = (approval: Approval) =>
    can("approval:decide") &&
    (currentUser.role === "system_admin" ||
      currentUser.role === approval.approverRole);
  const myPendingApprovalCount = snapshot.approvals.filter(
    (approval) =>
      approval.status === "pending" && canDecideApproval(approval),
  ).length;
  const visibleNavigation = navigation.filter(
    (item) => !item.permission || can(item.permission),
  );

  const selectedProject =
    snapshot.projects.find((project) => project.id === projectDrawerId) ?? null;
  const matchingProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return snapshot.projects;
    return snapshot.projects.filter((project) =>
      [
        project.code,
        project.name,
        project.productModel,
        project.customerName,
        project.orderNo || "",
        project.ownerName,
      ].some((value) => value.toLowerCase().includes(query)),
    );
  }, [search, snapshot.projects]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectDrawerId(null);
      setCreateProjectOpen(false);
      setCreateOrderOpen(false);
      setOrderLinkDialog(null);
      setFormEditor(null);
      setChangeEditorOpen(false);
      setApprovalDialog(null);
      setChangeDecisionDialog(null);
      setChangeVerifyDialog(null);
      setMilestoneDialog(null);
      setWaiveMilestoneDialog(null);
      setIssueCreateProject(null);
      setProjectStatusDialog(null);
      setIssueDialog(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function refreshWorkspace() {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const data = (await response.json()) as {
      snapshot?: WorkspaceSnapshot;
      error?: string;
    };
    if (!response.ok || !data.snapshot) {
      throw new Error(data.error || "刷新数据失败。");
    }
    setSnapshot(data.snapshot);
  }

  async function runAction(
    kind: string,
    payload: Record<string, unknown>,
    successMessage: string,
  ) {
    setPending(true);
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, payload }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "操作失败。");
      await refreshWorkspace();
      setToast(successMessage);
    } finally {
      setPending(false);
    }
  }

  function openProject(projectId: string, tab = "overview") {
    setProjectDrawerId(projectId);
    setProjectTab(tab);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            HD
          </div>
          <div>
            <strong>新品开发系统</strong>
            <span>New Product Development</span>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <p className="nav-section-label">项目运营</p>
          {visibleNavigation.slice(0, 6).map((item) => (
            <button
              className={activeView === item.key ? "nav-item is-active" : "nav-item"}
              key={item.key}
              onClick={() => {
                setActiveView(item.key);
                setMobileNavOpen(false);
              }}
            >
              <span className="nav-glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span>{item.label}</span>
              {item.key === "approvals" && myPendingApprovalCount > 0 ? (
                <span className="nav-count">{myPendingApprovalCount}</span>
              ) : null}
            </button>
          ))}
          <p className="nav-section-label nav-section-spaced">管理分析</p>
          {visibleNavigation.slice(6).map((item) => (
            <button
              className={activeView === item.key ? "nav-item is-active" : "nav-item"}
              key={item.key}
              onClick={() => {
                setActiveView(item.key);
                setMobileNavOpen(false);
              }}
            >
              <span className="nav-glyph" aria-hidden="true">
                {item.glyph}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="procedure-chip">
            <span>程序文件</span>
            <strong>HD/QP-SJ-01 · C0</strong>
            <small>10 份质量记录已数字化</small>
          </div>
          <div className="sidebar-user">
            <div className="avatar">{currentUser.avatar}</div>
            <div>
              <strong>{currentUser.name}</strong>
              <span>{currentUser.roleLabel}</span>
            </div>
            <span className="online-dot" title="在线" />
          </div>
        </div>
      </aside>

      {mobileNavOpen ? (
        <button
          className="mobile-scrim"
          aria-label="关闭导航"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <main className="main-shell">
        <header className="topbar">
          <button
            className="mobile-nav-button"
            aria-label="打开导航"
            onClick={() => setMobileNavOpen(true)}
          >
            ☰
          </button>
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="全局搜索"
              placeholder="搜索项目、型号、客户或订单号…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="topbar-meta">
            <span className="data-status">
              <i />
              数据已同步
            </span>
            <button className="icon-button" title="消息通知" aria-label="消息通知">
              ⏱
              <span className="notification-dot" />
            </button>
            <div className="topbar-role">
              <span>{currentUser.department}</span>
              <strong>{currentUser.roleLabel}</strong>
            </div>
          </div>
        </header>

        <div className="page-content">
          {activeView === "dashboard" ? (
            <DashboardView
              snapshot={snapshot}
              currentUser={currentUser}
              openProject={openProject}
              setView={setActiveView}
              onCreateProject={() => setCreateProjectOpen(true)}
              canCreateProject={can("project:create")}
              canDecideApproval={canDecideApproval}
              onApproval={(approval, decision) =>
                setApprovalDialog({ approval, decision })
              }
            />
          ) : null}
          {activeView === "projects" ? (
            <ProjectsView
              projects={matchingProjects}
              milestones={snapshot.milestones}
              onOpen={openProject}
              onCreate={() => setCreateProjectOpen(true)}
              canCreate={can("project:create")}
            />
          ) : null}
          {activeView === "orders" ? (
            <OrdersView
              snapshot={snapshot}
              openProject={openProject}
              canManage={can("order:manage")}
              canLink={can("order:link")}
              onCreate={() => setCreateOrderOpen(true)}
              onLink={setOrderLinkDialog}
              onUnlink={async (order) => {
                try {
                  await runAction(
                    "set_order_link",
                    { orderId: order.id, projectId: null },
                    `${order.orderNo} 已解除项目关联`,
                  );
                } catch (error) {
                  setToast(
                    error instanceof Error ? error.message : "解除关联失败",
                  );
                }
              }}
            />
          ) : null}
          {activeView === "forms" ? (
            <FormsView
              snapshot={snapshot}
              onEdit={(projectId, definition) =>
                setFormEditor({ projectId, definition })
              }
              canEdit={can("form:edit")}
            />
          ) : null}
          {activeView === "approvals" ? (
            <ApprovalsView
              approvals={snapshot.approvals}
              openProject={openProject}
              canDecide={canDecideApproval}
              onDecision={(approval, decision) =>
                setApprovalDialog({ approval, decision })
              }
            />
          ) : null}
          {activeView === "changes" ? (
            <ChangesView
              changes={snapshot.changes}
              onCreate={() => setChangeEditorOpen(true)}
              canCreate={can("change:create")}
              canApprove={can("change:approve")}
              onDecision={(change, decision) =>
                setChangeDecisionDialog({ change, decision })
              }
              onVerify={setChangeVerifyDialog}
              openProject={openProject}
            />
          ) : null}
          {activeView === "reports" ? (
            <ReportsView snapshot={snapshot} openProject={openProject} />
          ) : null}
          {activeView === "admin" ? (
            <AdminView
              snapshot={snapshot}
              pending={pending}
              onUpdate={async (user, update) => {
                try {
                  await runAction(
                    "update_user",
                    {
                      userId: user.id,
                      role: update.role ?? user.role,
                      department: update.department ?? user.department,
                      active: update.active ?? user.active,
                    },
                    `${user.name} 的岗位权限已更新`,
                  );
                } catch (error) {
                  setToast(
                    error instanceof Error ? error.message : "权限更新失败",
                  );
                }
              }}
            />
          ) : null}
        </div>
      </main>

      {selectedProject ? (
        <ProjectDrawer
          project={selectedProject}
          tab={projectTab}
          setTab={setProjectTab}
          milestones={snapshot.milestones.filter(
            (milestone) => milestone.projectId === selectedProject.id,
          )}
          issues={snapshot.issues.filter(
            (issue) => issue.projectId === selectedProject.id,
          )}
          documents={snapshot.documents.filter(
            (document) => document.projectId === selectedProject.id,
          )}
          formRecords={snapshot.formRecords.filter(
            (record) => record.projectId === selectedProject.id,
          )}
          onClose={() => setProjectDrawerId(null)}
          onEditForm={(definition) =>
            setFormEditor({ projectId: selectedProject.id, definition })
          }
          onResolveIssue={setIssueDialog}
          onUpdateMilestone={setMilestoneDialog}
          onWaiveMilestone={setWaiveMilestoneDialog}
          onCreateIssue={() => setIssueCreateProject(selectedProject)}
          onProjectStatus={(mode) =>
            setProjectStatusDialog({ project: selectedProject, mode })
          }
          canUpdate={can("project:update")}
          canClose={can("project:close")}
          canTailor={can("project:tailor")}
          canManageIssues={can("issue:manage")}
          canEditForm={can("form:edit")}
          canUpload={can("file:upload")}
          onUploaded={refreshWorkspace}
        />
      ) : null}

      {createProjectOpen ? (
        <CreateProjectDialog
          snapshot={snapshot}
          pending={pending}
          onClose={() => setCreateProjectOpen(false)}
          onSubmit={async (payload) => {
            try {
              await runAction("create_project", payload, "新品项目已创建");
              setCreateProjectOpen(false);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "创建失败");
            }
          }}
        />
      ) : null}

      {createOrderOpen ? (
        <CreateOrderDialog
          customers={snapshot.customers}
          pending={pending}
          onClose={() => setCreateOrderOpen(false)}
          onSubmit={async (payload) => {
            try {
              await runAction("create_order", payload, "销售订单已录入");
              setCreateOrderOpen(false);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "订单录入失败");
            }
          }}
        />
      ) : null}

      {orderLinkDialog ? (
        <OrderLinkDialog
          order={orderLinkDialog}
          projects={snapshot.projects}
          pending={pending}
          onClose={() => setOrderLinkDialog(null)}
          onSubmit={async (projectId) => {
            try {
              await runAction(
                "set_order_link",
                { orderId: orderLinkDialog.id, projectId },
                `${orderLinkDialog.orderNo} 已关联新品项目`,
              );
              setOrderLinkDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "订单关联失败");
            }
          }}
        />
      ) : null}

      {formEditor ? (
        <FormEditorDialog
          definition={formEditor.definition}
          project={snapshot.projects.find(
            (project) => project.id === formEditor.projectId,
          )}
          record={snapshot.formRecords.find(
            (record) =>
              record.projectId === formEditor.projectId &&
              record.formCode === formEditor.definition.code,
          )}
          pending={pending}
          canSubmit={can("form:submit")}
          readOnly={
            !can("form:edit") ||
            !snapshot.projects.some(
              (project) =>
                project.id === formEditor.projectId && isOpenProject(project),
            )
          }
          onClose={() => setFormEditor(null)}
          onSave={async (formPayload, submit) => {
            try {
              await runAction(
                "save_form",
                {
                  projectId: formEditor.projectId,
                  formCode: formEditor.definition.code,
                  formPayload,
                  submit,
                },
                submit ? "表单已提交审批" : "表单草稿已保存",
              );
              setFormEditor(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "保存失败");
            }
          }}
        />
      ) : null}

      {changeEditorOpen ? (
        <CreateChangeDialog
          projects={snapshot.projects}
          pending={pending}
          onClose={() => setChangeEditorOpen(false)}
          onSubmit={async (payload) => {
            try {
              await runAction("create_change", payload, "变更申请已进入评审");
              setChangeEditorOpen(false);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "提交失败");
            }
          }}
        />
      ) : null}

      {approvalDialog ? (
        <DecisionDialog
          approval={approvalDialog.approval}
          decision={approvalDialog.decision}
          pending={pending}
          onClose={() => setApprovalDialog(null)}
          onSubmit={async (comment) => {
            try {
              await runAction(
                "decide_approval",
                {
                  approvalId: approvalDialog.approval.id,
                  decision: approvalDialog.decision,
                  comment,
                },
                approvalDialog.decision === "approved"
                  ? "审批已通过"
                  : "审批已退回",
              );
              setApprovalDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "审批失败");
            }
          }}
        />
      ) : null}

      {changeDecisionDialog ? (
        <ChangeDecisionDialog
          change={changeDecisionDialog.change}
          decision={changeDecisionDialog.decision}
          pending={pending}
          onClose={() => setChangeDecisionDialog(null)}
          onSubmit={async (comment) => {
            try {
              await runAction(
                "decide_change",
                {
                  changeId: changeDecisionDialog.change.id,
                  decision: changeDecisionDialog.decision,
                  comment,
                },
                changeDecisionDialog.decision === "approved"
                  ? "变更已批准执行"
                  : "变更已退回补充",
              );
              setChangeDecisionDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "变更审批失败");
            }
          }}
        />
      ) : null}

      {changeVerifyDialog ? (
        <ChangeVerificationDialog
          change={changeVerifyDialog}
          pending={pending}
          onClose={() => setChangeVerifyDialog(null)}
          onSubmit={async (verification) => {
            try {
              await runAction(
                "verify_change",
                { changeId: changeVerifyDialog.id, verification },
                "变更实施效果已验证并归档",
              );
              setChangeVerifyDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "变更验证失败");
            }
          }}
        />
      ) : null}

      {milestoneDialog ? (
        <MilestoneUpdateDialog
          milestone={milestoneDialog}
          project={snapshot.projects.find(
            (project) => project.id === milestoneDialog.projectId,
          )}
          pending={pending}
          onClose={() => setMilestoneDialog(null)}
          onSubmit={async (payload) => {
            try {
              await runAction(
                "update_milestone",
                { milestoneId: milestoneDialog.id, ...payload },
                `${milestoneDialog.name} 进度已更新`,
              );
              setMilestoneDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "进度更新失败");
            }
          }}
        />
      ) : null}

      {waiveMilestoneDialog ? (
        <MilestoneWaiverDialog
          milestone={waiveMilestoneDialog}
          pending={pending}
          onClose={() => setWaiveMilestoneDialog(null)}
          onSubmit={async (reason) => {
            try {
              await runAction(
                "waive_milestone",
                { milestoneId: waiveMilestoneDialog.id, reason },
                `${waiveMilestoneDialog.name} 已完成风险裁剪`,
              );
              setWaiveMilestoneDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "阶段裁剪失败");
            }
          }}
        />
      ) : null}

      {issueCreateProject ? (
        <CreateIssueDialog
          project={issueCreateProject}
          users={snapshot.users}
          pending={pending}
          onClose={() => setIssueCreateProject(null)}
          onSubmit={async (payload) => {
            try {
              await runAction("create_issue", payload, "项目问题已建立");
              setIssueCreateProject(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "问题创建失败");
            }
          }}
        />
      ) : null}

      {projectStatusDialog ? (
        <ProjectStatusDialog
          project={projectStatusDialog.project}
          mode={projectStatusDialog.mode}
          pending={pending}
          onClose={() => setProjectStatusDialog(null)}
          onSubmit={async (reason) => {
            try {
              if (projectStatusDialog.mode === "terminate") {
                await runAction(
                  "terminate_project",
                  { projectId: projectStatusDialog.project.id, reason },
                  `${projectStatusDialog.project.code} 已终止并关闭待审批事项`,
                );
              } else {
                await runAction(
                  "set_project_paused",
                  {
                    projectId: projectStatusDialog.project.id,
                    paused: projectStatusDialog.mode === "pause",
                    reason,
                  },
                  projectStatusDialog.mode === "pause"
                    ? "项目已暂停"
                    : "项目已恢复",
                );
              }
              setProjectStatusDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "项目状态更新失败");
            }
          }}
        />
      ) : null}

      {issueDialog ? (
        <ResolveIssueDialog
          issue={issueDialog}
          pending={pending}
          onClose={() => setIssueDialog(null)}
          onSubmit={async (resolution) => {
            try {
              await runAction(
                "resolve_issue",
                { issueId: issueDialog.id, resolution },
                "问题已关闭并写入追踪记录",
              );
              setIssueDialog(null);
            } catch (error) {
              setToast(error instanceof Error ? error.message : "关闭失败");
            }
          }}
        />
      ) : null}

      {toast ? (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </div>
  );
}

function DashboardView({
  snapshot,
  currentUser,
  openProject,
  setView,
  onCreateProject,
  canCreateProject,
  canDecideApproval,
  onApproval,
}: {
  snapshot: WorkspaceSnapshot;
  currentUser: CurrentUser;
  openProject: (id: string, tab?: string) => void;
  setView: (view: ViewKey) => void;
  onCreateProject: () => void;
  canCreateProject: boolean;
  canDecideApproval: (approval: Approval) => boolean;
  onApproval: (
    approval: Approval,
    decision: "approved" | "rejected",
  ) => void;
}) {
  const active = snapshot.projects.filter(isOpenProject);
  const keyProjects = active.slice(0, 4);
  const openIssues = snapshot.issues.filter((issue) => issue.status === "open");
  const pendingApprovals = snapshot.approvals.filter(
    (approval) =>
      approval.status === "pending" && canDecideApproval(approval),
  );
  const dueSoon = snapshot.milestones.filter(
    (milestone) =>
      milestone.status !== "completed" &&
      daysUntil(milestone.plannedDate) <= 7,
  ).length;
  const highRiskCount = active.filter(
    (project) =>
      project.riskLevel === "high" || project.riskLevel === "critical",
  ).length;
  const watchCount = active.filter(
    (project) => project.riskLevel === "medium",
  ).length;
  const healthyCount = active.length - highRiskCount - watchCount;

  return (
    <>
      <PageHeader
        eyebrow={fullDateLabel()}
        title={`${greeting()}，${currentUser.name}`}
        description={`这里是新品开发全流程运行概览。未来 7 天有 ${dueSoon} 个关键节点，当前有 ${openIssues.length} 项问题需要跟踪。`}
        actions={
          <>
            <button className="button secondary" onClick={() => setView("reports")}>
              生成周报
            </button>
            {canCreateProject ? (
              <button className="button primary" onClick={onCreateProject}>
                <span>＋</span> 新建项目
              </button>
            ) : null}
          </>
        }
      />

      <section className="metric-grid" aria-label="关键指标">
        <MetricCard
          label="在研项目"
          value={snapshot.metrics.activeProjects}
          unit="项"
          delta="+2"
          note="较上月"
          tone="navy"
          glyph="项"
        />
        <MetricCard
          label="阶段按期率"
          value={snapshot.metrics.onTimeRate}
          unit="%"
          delta="+3.4%"
          note="本季度"
          tone="teal"
          glyph="期"
        />
        <MetricCard
          label="逾期里程碑"
          value={snapshot.metrics.overdueMilestones}
          unit="项"
          delta="需关注"
          note="含 1 项高风险"
          tone="amber"
          glyph="!"
        />
        <MetricCard
          label="待我审批"
          value={pendingApprovals.length}
          unit="项"
          delta={`${pendingApprovals.filter((approval) => daysUntil(approval.dueAt) <= 2).length} 项`}
          note="将在 48h 内到期"
          tone="red"
          glyph="审"
        />
      </section>

      <section className="dashboard-grid dashboard-grid-top">
        <div className="panel stage-health-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">全局阶段门</span>
              <h2>项目分布与阶段健康度</h2>
            </div>
            <button className="text-button" onClick={() => setView("projects")}>
              查看全部项目 →
            </button>
          </div>
          <div className="stage-distribution">
            {gateOrder.map((gate, index) => {
              const count = active.filter((project) => project.stage === gate).length;
              return (
                <div className="stage-column" key={gate}>
                  <div className={`stage-column-bar stage-tone-${index}`}>
                    <span style={{ height: `${Math.max(10, count * 24)}%` }} />
                  </div>
                  <strong>{count}</strong>
                  <small>{gateLabels[gate]}</small>
                </div>
              );
            })}
          </div>
          <div className="health-footer">
            <div>
              <span className="health-ring">{snapshot.metrics.onTimeRate}%</span>
              <p>
                <strong>总体健康</strong>
                <small>按期阶段占比</small>
              </p>
            </div>
            <div className="health-legend">
              <span>
                <i className="legend-dot healthy" /> 正常推进 {healthyCount}
              </span>
              <span>
                <i className="legend-dot watch" /> 需关注 {watchCount}
              </span>
              <span>
                <i className="legend-dot danger" /> 高风险 {highRiskCount}
              </span>
            </div>
          </div>
        </div>

        <div className="panel attention-panel">
          <div className="panel-heading compact">
            <div>
              <span className="panel-kicker">今日优先级</span>
              <h2>风险与异常</h2>
            </div>
            <span className="count-badge">{openIssues.length}</span>
          </div>
          <div className="attention-list">
            {openIssues.slice(0, 4).map((issue) => (
              <button
                className="attention-item"
                key={issue.id}
                onClick={() => openProject(issue.projectId, "issues")}
              >
                <span className={`severity-rail ${issue.severity}`} />
                <div>
                  <span className="item-meta">
                    {issue.projectCode} · {issue.category}
                  </span>
                  <strong>{issue.title}</strong>
                  <small>
                    责任人 {issue.ownerName} · 截止 {formatDate(issue.dueDate)}
                  </small>
                </div>
                <span className={`risk-badge ${issue.severity}`}>
                  {riskLabels[issue.severity]}
                </span>
              </button>
            ))}
          </div>
          <button className="panel-footer-button" onClick={() => setView("projects")}>
            查看全部风险与问题
          </button>
        </div>
      </section>

      <section className="panel key-projects-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">重点跟踪</span>
            <h2>关键项目</h2>
          </div>
          <div className="legend-inline">
            <span>
              <i className="legend-dot healthy" /> 正常
            </span>
            <span>
              <i className="legend-dot watch" /> 关注
            </span>
            <span>
              <i className="legend-dot danger" /> 风险
            </span>
          </div>
        </div>
        <div className="project-card-grid">
          {keyProjects.map((project) => (
            <button
              className="project-summary-card"
              key={project.id}
              onClick={() => openProject(project.id)}
            >
              <div className="project-summary-top">
                <span className={`project-code risk-${project.riskLevel}`}>
                  {project.code}
                </span>
                <span className={`risk-badge ${project.riskLevel}`}>
                  {riskLabels[project.riskLevel]}
                </span>
              </div>
              <h3>{project.name}</h3>
              <p>
                {project.customerName} · {project.productModel}
              </p>
              <div className="project-progress-row">
                <span>{project.stageLabel}</span>
                <strong>{project.progress}%</strong>
              </div>
              <div className="progress-track">
                <span
                  className={`progress-fill ${project.riskLevel}`}
                  style={{ width: `${project.progress}%` }}
                />
              </div>
              <div className="project-card-footer">
                <div className="avatar small">{initials(project.ownerName)}</div>
                <span>{project.ownerName}</span>
                <span className="footer-spacer" />
                <span className={project.overdueDays > 0 ? "date-overdue" : ""}>
                  {project.overdueDays > 0
                    ? `逾期 ${project.overdueDays} 天`
                    : `${formatDate(project.nextMilestoneDate)} 节点`}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="dashboard-grid dashboard-grid-bottom">
        <div className="panel approvals-panel">
          <div className="panel-heading compact">
            <div>
              <span className="panel-kicker">待办</span>
              <h2>待审批事项</h2>
            </div>
            <button className="text-button" onClick={() => setView("approvals")}>
              全部 {pendingApprovals.length} 项
            </button>
          </div>
          <div className="approval-mini-list">
            {pendingApprovals.slice(0, 3).map((approval) => (
              <div className="approval-mini-item" key={approval.id}>
                <div className="form-code-box">{approval.formCode.split("-").at(-1)}</div>
                <div>
                  <strong>{approval.title}</strong>
                  <span>
                    {approval.projectCode} · {approval.submitterName} 提交
                  </span>
                </div>
                <div className="approval-mini-actions">
                  <small>截止 {formatDate(approval.dueAt)}</small>
                  <button onClick={() => onApproval(approval, "rejected")}>
                    退回
                  </button>
                  <button
                    className="approve"
                    onClick={() => onApproval(approval, "approved")}
                  >
                    通过
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel activity-panel">
          <div className="panel-heading compact">
            <div>
              <span className="panel-kicker">审计留痕</span>
              <h2>最近动态</h2>
            </div>
          </div>
          <div className="activity-list">
            {snapshot.activities.slice(0, 5).map((activity) => (
              <div className="activity-row" key={activity.id}>
                <span className="activity-dot" />
                <div>
                  <p>
                    <strong>{activity.actorName}</strong>
                    <span>{activity.action}</span>
                    {activity.projectCode ? (
                      <button
                        onClick={() =>
                          activity.projectId && openProject(activity.projectId)
                        }
                      >
                        {activity.projectCode}
                      </button>
                    ) : null}
                  </p>
                  <span>{activity.detail}</span>
                  <small>{relativeTime(activity.createdAt)}</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function MetricCard({
  label,
  value,
  unit,
  delta,
  note,
  tone,
  glyph,
}: {
  label: string;
  value: number;
  unit: string;
  delta: string;
  note: string;
  tone: string;
  glyph: string;
}) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <div className="metric-card-top">
        <span>{label}</span>
        <i aria-hidden="true">{glyph}</i>
      </div>
      <div className="metric-value">
        <strong>{value}</strong>
        <span>{unit}</span>
      </div>
      <div className="metric-foot">
        <b>{delta}</b>
        <span>{note}</span>
      </div>
    </div>
  );
}

function ProjectsView({
  projects,
  milestones,
  onOpen,
  onCreate,
  canCreate,
}: {
  projects: Project[];
  milestones: Milestone[];
  onOpen: (id: string, tab?: string) => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const [riskFilter, setRiskFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const filtered = projects.filter(
    (project) =>
      (riskFilter === "all" || project.riskLevel === riskFilter) &&
      (stageFilter === "all" || project.stage === stageFilter),
  );

  return (
    <>
      <PageHeader
        eyebrow="Portfolio · 项目组合"
        title="新品项目"
        description="按阶段门管理从立项、设计到定型和变更的全过程，所有数据与订单、表单和责任人联动。"
        actions={
          canCreate ? (
            <button className="button primary" onClick={onCreate}>
              <span>＋</span> 新建项目
            </button>
          ) : undefined
        }
      />
      <div className="toolbar panel">
        <div className="filter-group">
          <label>
            风险
            <select
              value={riskFilter}
              onChange={(event) => setRiskFilter(event.target.value)}
            >
              <option value="all">全部风险</option>
              <option value="high">高风险</option>
              <option value="medium">中风险</option>
              <option value="low">低风险</option>
            </select>
          </label>
          <label>
            当前阶段
            <select
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value)}
            >
              <option value="all">全部阶段</option>
              {gateOrder.map((gate) => (
                <option key={gate} value={gate}>
                  {gateLabels[gate]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <span className="result-count">共 {filtered.length} 个项目</span>
      </div>

      <div className="panel table-panel">
        <div className="data-table-wrap">
          <table className="data-table projects-table">
            <thead>
              <tr>
                <th>项目 / 产品</th>
                <th>客户与订单</th>
                <th>当前阶段</th>
                <th>总体进度</th>
                <th>下一节点</th>
                <th>负责人</th>
                <th>风险</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((project) => {
                const projectMilestones = milestones.filter(
                  (milestone) => milestone.projectId === project.id,
                );
                return (
                  <tr key={project.id} onClick={() => onOpen(project.id)}>
                    <td>
                      <div className="table-primary">
                        <span className="project-code simple">{project.code}</span>
                        <strong>{project.name}</strong>
                        <small>
                          {project.productModel} · {project.category}
                        </small>
                      </div>
                    </td>
                    <td>
                      <strong className="table-strong">{project.customerName}</strong>
                      <small className="table-muted">
                        {project.orderNo || "内部研发 · 无订单"}
                      </small>
                    </td>
                    <td>
                      <span className="stage-pill">{project.stageLabel}</span>
                      <small className="table-muted">
                        {
                          projectMilestones.filter(
                            (milestone) => milestone.status === "completed",
                          ).length
                        }
                        /{projectMilestones.length} 阶段完成
                      </small>
                    </td>
                    <td>
                      <div className="table-progress">
                        <div className="progress-track small">
                          <span
                            className={`progress-fill ${project.riskLevel}`}
                            style={{ width: `${project.progress}%` }}
                          />
                        </div>
                        <strong>{project.progress}%</strong>
                      </div>
                    </td>
                    <td>
                      <strong className="table-strong">{project.nextMilestone}</strong>
                      <small
                        className={
                          project.overdueDays > 0
                            ? "table-muted date-overdue"
                            : "table-muted"
                        }
                      >
                        {project.overdueDays > 0
                          ? `已逾期 ${project.overdueDays} 天`
                          : formatDate(project.nextMilestoneDate)}
                      </small>
                    </td>
                    <td>
                      <div className="person-cell">
                        <span className="avatar tiny">
                          {initials(project.ownerName)}
                        </span>
                        <span>{project.ownerName}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`risk-badge ${project.riskLevel}`}>
                        {riskLabels[project.riskLevel]}
                      </span>
                      {project.issueCount ? (
                        <small className="table-muted">
                          {project.issueCount} 项未关闭
                        </small>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function OrdersView({
  snapshot,
  openProject,
  canManage,
  canLink,
  onCreate,
  onLink,
  onUnlink,
}: {
  snapshot: WorkspaceSnapshot;
  openProject: (id: string) => void;
  canManage: boolean;
  canLink: boolean;
  onCreate: () => void;
  onLink: (order: SalesOrder) => void;
  onUnlink: (order: SalesOrder) => Promise<void>;
}) {
  const activeOrders = snapshot.orders.filter(
    (order) => order.status !== "completed",
  );
  const linkedActiveOrders = activeOrders.filter((order) => order.projectId);
  const dueWithin60Days = snapshot.orders.filter(
    (order) =>
      order.deliveryDate >= currentDateIso() &&
      order.deliveryDate <= addDaysIso(currentDateIso(), 60),
  ).length;
  const riskyOrder = activeOrders.find((order) => {
    const project = snapshot.projects.find(
      (candidate) => candidate.id === order.projectId,
    );
    return (
      project?.riskLevel === "high" || project?.riskLevel === "critical"
    );
  });
  return (
    <>
      <PageHeader
        eyebrow="Order Linkage · 订单驱动"
        title="订单关联"
        description="把客户订单、交付约束和新品项目绑定，避免技术开发与销售交付计划脱节。"
        actions={
          canManage ? (
            <button className="button primary" onClick={onCreate}>
              <span>＋</span> 录入销售订单
            </button>
          ) : undefined
        }
      />
      <section className="metric-grid compact-metrics">
        <MetricCard
          label="订单项目覆盖率"
          value={snapshot.metrics.orderCoverage}
          unit="%"
          delta={`${linkedActiveOrders.length}/${activeOrders.length}`}
          note="有效订单已关联"
          tone="teal"
          glyph="联"
        />
        <MetricCard
          label="关联金额"
          value={Math.round(
            snapshot.orders
              .filter((order) => order.currency === "CNY")
              .reduce((sum, order) => sum + order.amount, 0) / 10000,
          )}
          unit="万元"
          delta={`${snapshot.orders.length} 单`}
          note="人民币订单，外币未折算"
          tone="navy"
          glyph="¥"
        />
        <MetricCard
          label="60 天内交付"
          value={dueWithin60Days}
          unit="单"
          delta={`${dueWithin60Days} 单`}
          note="处于验证或确认"
          tone="amber"
          glyph="期"
        />
        <MetricCard
          label="交付高风险"
          value={riskyOrder ? 1 : 0}
          unit="单"
          delta={riskyOrder?.orderNo || "无"}
          note="设计评审受阻"
          tone="red"
          glyph="!"
        />
      </section>
      <div className="panel table-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">销售订单</span>
            <h2>订单—项目联动清单</h2>
          </div>
          <span className="result-count">{snapshot.orders.length} 条记录</span>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>订单号</th>
                <th>客户</th>
                <th>产品型号 / 数量</th>
                <th>订单金额</th>
                <th>交期</th>
                <th>订单状态</th>
                <th>关联项目</th>
                <th>关联操作</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.orders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => order.projectId && openProject(order.projectId)}
                >
                  <td>
                    <span className="project-code simple">{order.orderNo}</span>
                  </td>
                  <td>
                    <strong className="table-strong">{order.customerName}</strong>
                  </td>
                  <td>
                    <strong className="table-strong">{order.productModel}</strong>
                    <small className="table-muted">{order.quantity} 台</small>
                  </td>
                  <td>
                    <strong className="table-strong">
                      {formatCurrency(order.amount, order.currency)}
                    </strong>
                  </td>
                  <td>
                    <strong className="table-strong">
                      {formatDate(order.deliveryDate)}
                    </strong>
                    <small className="table-muted">
                      剩余 {daysUntil(order.deliveryDate)} 天
                    </small>
                  </td>
                  <td>
                    <span className={`status-chip ${order.status}`}>
                      {statusLabels[order.status] || order.status}
                    </span>
                  </td>
                  <td>
                    {order.projectId ? (
                      <>
                        <strong className="link-strong">{order.projectCode}</strong>
                        <small className="table-muted">{order.projectName}</small>
                      </>
                    ) : (
                      <span className="empty-value">尚未关联</span>
                    )}
                  </td>
                  <td>
                    {canLink ? (
                      <div className="table-actions">
                        {order.projectId ? (
                          <button
                            className="table-action reject"
                            onClick={(event) => {
                              event.stopPropagation();
                              void onUnlink(order);
                            }}
                          >
                            解除
                          </button>
                        ) : (
                          <button
                            className="table-action approve"
                            onClick={(event) => {
                              event.stopPropagation();
                              onLink(order);
                            }}
                          >
                            关联项目
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="empty-value">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function FormsView({
  snapshot,
  onEdit,
  canEdit,
}: {
  snapshot: WorkspaceSnapshot;
  onEdit: (projectId: string, definition: FormDefinition) => void;
  canEdit: boolean;
}) {
  const [projectId, setProjectId] = useState(
    snapshot.projects.find(isOpenProject)?.id ||
      snapshot.projects[0]?.id ||
      "",
  );
  const project = snapshot.projects.find((item) => item.id === projectId);

  return (
    <>
      <PageHeader
        eyebrow="Quality Records · 质量记录"
        title="表单中心"
        description="10 份程序表单统一在线填写、提交、审批、版本留痕，并自动判断阶段资料是否齐套。"
        actions={
          <label className="project-select">
            当前项目
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              {snapshot.projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.name}
                </option>
              ))}
            </select>
          </label>
        }
      />

      {project ? (
        <div className="form-readiness panel">
          <div>
            <span className="panel-kicker">阶段资料齐套度</span>
            <h2>
              {project.code} · {project.name}
            </h2>
            <p>
              当前阶段：{project.stageLabel} · 项目负责人：{project.ownerName}
            </p>
          </div>
          <div className="readiness-score">
            <strong>{project.formCompletion}%</strong>
            <span>记录齐套</span>
          </div>
          <div className="readiness-track">
            <span style={{ width: `${project.formCompletion}%` }} />
          </div>
        </div>
      ) : null}

      <div className="form-library-grid">
        {formDefinitions.map((definition, index) => {
          const record = snapshot.formRecords.find(
            (item) =>
              item.projectId === projectId && item.formCode === definition.code,
          );
          return (
            <div className="form-library-card" key={definition.code}>
              <div className="form-card-number">{String(index + 1).padStart(2, "0")}</div>
              <div className="form-card-main">
                <span className="form-card-code">{definition.code}</span>
                <h3>{definition.name}</h3>
                <p>{definition.purpose}</p>
                <div className="form-card-meta">
                  <span>阶段：{definition.stage}</span>
                  <span>主责：{definition.ownerDepartment}</span>
                </div>
              </div>
              <div className="form-card-state">
                <span className={`status-chip ${record?.status || "not_started"}`}>
                  {record
                    ? statusLabels[record.status] || record.status
                    : "未开始"}
                </span>
                {record ? (
                  <small>
                    V{record.version} · {record.updatedBy}
                  </small>
                ) : (
                  <small>尚未建立记录</small>
                )}
                <button
                  className="button small secondary"
                  disabled={!projectId}
                  onClick={() => onEdit(projectId, definition)}
                >
                  {!canEdit || (project && !isOpenProject(project))
                    ? "仅查看"
                    : record
                      ? "查看 / 编辑"
                      : "开始填写"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ApprovalsView({
  approvals,
  openProject,
  canDecide,
  onDecision,
}: {
  approvals: Approval[];
  openProject: (id: string) => void;
  canDecide: (approval: Approval) => boolean;
  onDecision: (
    approval: Approval,
    decision: "approved" | "rejected",
  ) => void;
}) {
  const [filter, setFilter] = useState("pending");
  const filtered = approvals.filter(
    (approval) => filter === "all" || approval.status === filter,
  );
  return (
    <>
      <PageHeader
        eyebrow="Approval Center · 审批闭环"
        title="我的审批"
        description="按角色和阶段门分派审批，保留结论、意见、时间与版本，所有决定均进入审计记录。"
      />
      <div className="approval-tabs">
        {[
          ["pending", "待审批"],
          ["approved", "已通过"],
          ["rejected", "已退回"],
          ["all", "全部"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? "is-active" : ""}
            onClick={() => setFilter(key)}
          >
            {label}
            <span>
              {key === "all"
                ? approvals.length
                : approvals.filter((approval) => approval.status === key).length}
            </span>
          </button>
        ))}
      </div>
      <div className="approval-card-list">
        {filtered.map((approval) => (
          <article className="approval-card" key={approval.id}>
            <div className="approval-card-icon">{approval.formCode.split("-").at(-1)}</div>
            <div className="approval-card-content">
              <div className="approval-card-title-row">
                <span className={`status-chip ${approval.status}`}>
                  {statusLabels[approval.status]}
                </span>
                <span>{approval.approverLabel}审批</span>
              </div>
              <h2>{approval.title}</h2>
              <button
                className="project-inline-link"
                onClick={() => openProject(approval.projectId)}
              >
                {approval.projectCode} · {approval.projectName}
              </button>
              <p>{approval.comment}</p>
              <div className="approval-details">
                <span>提交人：{approval.submitterName}</span>
                <span>提交：{approval.submittedAt}</span>
                <span>截止：{approval.dueAt}</span>
              </div>
            </div>
            <div className="approval-card-actions">
              {approval.status === "pending" && canDecide(approval) ? (
                <>
                  <button
                    className="button secondary"
                    onClick={() => onDecision(approval, "rejected")}
                  >
                    退回补充
                  </button>
                  <button
                    className="button primary"
                    onClick={() => onDecision(approval, "approved")}
                  >
                    审批通过
                  </button>
                </>
              ) : (
                <div className="decision-stamp">
                  <strong>{statusLabels[approval.status]}</strong>
                  <span>{approval.decisionAt || "等待处理"}</span>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function ChangesView({
  changes,
  onCreate,
  canCreate,
  canApprove,
  onDecision,
  onVerify,
  openProject,
}: {
  changes: ChangeRequest[];
  onCreate: () => void;
  canCreate: boolean;
  canApprove: boolean;
  onDecision: (
    change: ChangeRequest,
    decision: "approved" | "rejected",
  ) => void;
  onVerify: (change: ChangeRequest) => void;
  openProject: (id: string, tab?: string) => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Engineering Change · 工程变更"
        title="变更控制"
        description="客户、设计与工艺变更统一评估影响，覆盖图纸/CAXA、供应商与客户通知、旧件处置及实施验证。"
        actions={
          canCreate ? (
            <button className="button primary" onClick={onCreate}>
              <span>＋</span> 发起变更
            </button>
          ) : undefined
        }
      />
      <section className="change-overview">
        <div className="change-stat">
          <span>待评审</span>
          <strong>
            {changes.filter((change) => change.status === "under_review").length}
          </strong>
        </div>
        <div className="change-stat">
          <span>草稿</span>
          <strong>{changes.filter((change) => change.status === "draft").length}</strong>
        </div>
        <div className="change-stat">
          <span>本月已批准</span>
          <strong>
            {changes.filter((change) => change.status === "approved").length}
          </strong>
        </div>
        <div className="change-stat">
          <span>需通知客户</span>
          <strong>{changes.filter((change) => change.customerNotice).length}</strong>
        </div>
      </section>
      <div className="panel table-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>变更编号 / 类型</th>
                <th>项目</th>
                <th>变更内容</th>
                <th>影响对象</th>
                <th>外部通知</th>
                <th>旧件处置</th>
                <th>状态 / 截止</th>
                <th>评审操作</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr
                  key={change.id}
                  onClick={() => openProject(change.projectId, "overview")}
                >
                  <td>
                    <span className="project-code simple">{change.changeNo}</span>
                    <small className="table-muted">{change.changeType}</small>
                  </td>
                  <td>
                    <strong className="link-strong">{change.projectCode}</strong>
                    <small className="table-muted">{change.projectName}</small>
                  </td>
                  <td>
                    <strong className="table-strong">{change.title}</strong>
                    <small className="table-muted clamp">{change.reason}</small>
                  </td>
                  <td>
                    <span className="table-strong">{change.affectedObject}</span>
                  </td>
                  <td>
                    <div className="notice-tags">
                      {change.supplierNotice ? <span>供应商</span> : null}
                      {change.customerNotice ? <span>客户</span> : null}
                      {!change.supplierNotice && !change.customerNotice ? (
                        <span className="muted">无需外部通知</span>
                      ) : null}
                    </div>
                  </td>
                  <td>{change.disposition}</td>
                  <td>
                    <span className={`status-chip ${change.status}`}>
                      {statusLabels[change.status]}
                    </span>
                    <small className="table-muted">{formatDate(change.dueDate)}</small>
                  </td>
                  <td>
                    {change.status === "under_review" && canApprove ? (
                      <div className="table-actions">
                        <button
                          className="table-action reject"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDecision(change, "rejected");
                          }}
                        >
                          退回
                        </button>
                        <button
                          className="table-action approve"
                          onClick={(event) => {
                            event.stopPropagation();
                            onDecision(change, "approved");
                          }}
                        >
                          批准
                        </button>
                      </div>
                    ) : change.status === "approved" && canApprove ? (
                      <button
                        className="table-action approve"
                        onClick={(event) => {
                          event.stopPropagation();
                          onVerify(change);
                        }}
                      >
                        实施验证
                      </button>
                    ) : (
                      <span className="empty-value">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="process-note">
        <span>流程提示</span>
        图样和工艺变更必须重新会签、审核、批准；生产计划负责旧件配套处置，质量部与相关部门跟踪实施效果。
      </div>
    </>
  );
}

function ReportsView({
  snapshot,
  openProject,
}: {
  snapshot: WorkspaceSnapshot;
  openProject: (id: string) => void;
}) {
  const departments = [
    ["技术·设计", 78, "#23506f"],
    ["技术·工艺", 64, "#3a7792"],
    ["采购", 48, "#7fa8b8"],
    ["制造·装配", 71, "#c68b3c"],
    ["质量", 58, "#d75d45"],
    ["销售", 42, "#8799a4"],
  ] as const;
  const activeProjects = snapshot.projects.filter(isOpenProject);

  return (
    <>
      <PageHeader
        eyebrow="Analytics · 进度与绩效"
        title="进度与分析"
        description="从项目组合、阶段按期、部门负荷和质量问题四个视角识别新品开发瓶颈。"
        actions={
          <button className="button secondary" onClick={() => window.print()}>
            导出管理周报
          </button>
        }
      />
      <section className="metric-grid compact-metrics">
        <MetricCard
          label="阶段按期率"
          value={snapshot.metrics.onTimeRate}
          unit="%"
          delta="+3.4%"
          note="较上季度"
          tone="teal"
          glyph="期"
        />
        <MetricCard
          label="平均开发周期"
          value={snapshot.metrics.averageCycleDays}
          unit="天"
          delta="-8 天"
          note="同比改善"
          tone="navy"
          glyph="时"
        />
        <MetricCard
          label="高风险项目"
          value={snapshot.metrics.highRiskProjects}
          unit="项"
          delta="1 项"
          note="处于输出评审"
          tone="red"
          glyph="险"
        />
        <MetricCard
          label="订单覆盖"
          value={snapshot.metrics.orderCoverage}
          unit="%"
          delta="100%"
          note="本月新增订单"
          tone="amber"
          glyph="单"
        />
      </section>
      <section className="report-grid">
        <div className="panel portfolio-bars">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Portfolio</span>
              <h2>项目进度对比</h2>
            </div>
          </div>
          <div className="horizontal-bars">
            {activeProjects.map((project) => (
              <button key={project.id} onClick={() => openProject(project.id)}>
                <span>{project.code}</span>
                <div>
                  <i
                    className={project.riskLevel}
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
                <strong>{project.progress}%</strong>
              </button>
            ))}
          </div>
        </div>
        <div className="panel workload-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Capacity</span>
              <h2>部门负荷指数</h2>
            </div>
          </div>
          <div className="workload-chart">
            {departments.map(([department, value, color]) => (
              <div key={department}>
                <span>{department}</span>
                <div>
                  <i style={{ width: `${value}%`, background: color }} />
                </div>
                <strong>{value}%</strong>
              </div>
            ))}
          </div>
          <p className="chart-note">
            技术设计负荷接近预警线，建议将新立项的高温风机电机部分结构计算任务分配给第二设计组。
          </p>
        </div>
        <div className="panel stage-funnel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Stage Gate</span>
              <h2>阶段门转化</h2>
            </div>
          </div>
          <div className="funnel-list">
            {gateOrder.slice(0, 8).map((gate, index) => (
              <div key={gate} style={{ width: `${100 - index * 6}%` }}>
                <span>{gateLabels[gate]}</span>
                <strong>{Math.max(2, 14 - index * 2)}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="panel issue-analysis">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Quality</span>
              <h2>问题结构</h2>
            </div>
          </div>
          <div className="issue-donut-wrap">
            <div className="css-donut">
              <div>
                <strong>{snapshot.issues.length}</strong>
                <span>问题总数</span>
              </div>
            </div>
            <div className="donut-legend">
              {[
                ["技术", 38, "navy"],
                ["供应链", 24, "teal"],
                ["验证", 21, "amber"],
                ["客户现场", 17, "slate"],
              ].map(([label, value, tone]) => (
                <span key={label}>
                  <i className={`legend-dot ${tone}`} />
                  {label}
                  <strong>{value}%</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function AdminView({
  snapshot,
  pending,
  onUpdate,
}: {
  snapshot: WorkspaceSnapshot;
  pending: boolean;
  onUpdate: (
    user: UserRecord,
    update: Partial<Pick<UserRecord, "role" | "department" | "active">>,
  ) => Promise<void>;
}) {
  const roles = Object.entries(roleLabels);
  const matrixPermissions: Array<[Permission, string]> = [
    ["project:create", "创建项目"],
    ["project:update", "更新进度"],
    ["project:tailor", "流程裁剪"],
    ["order:manage", "录入订单"],
    ["order:link", "关联订单"],
    ["form:edit", "编辑表单"],
    ["approval:decide", "审批决策"],
    ["change:approve", "批准变更"],
    ["user:manage", "人员权限"],
  ];

  return (
    <>
      <PageHeader
        eyebrow="RBAC · 人员与权限"
        title="人员与权限"
        description="基于岗位的最小权限控制。审批和变更等关键动作由服务端校验，不依赖页面按钮可见性。"
        actions={<span className="managed-badge">首次登录自动建档</span>}
      />
      <section className="admin-grid">
        <div className="panel users-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">成员目录</span>
              <h2>人员与当前负荷</h2>
            </div>
            <span className="result-count">{snapshot.users.length} 人</span>
          </div>
          <div className="user-list">
            {snapshot.users.map((user) => (
              <div className="user-row" key={user.id}>
                <span className="avatar">{initials(user.name)}</span>
                <div>
                  <strong>{user.name}</strong>
                  <input
                    className="department-input"
                    defaultValue={user.department}
                    disabled={pending}
                    aria-label={`${user.name}所属部门`}
                    onBlur={(event) => {
                      const department = event.target.value.trim();
                      if (department && department !== user.department) {
                        void onUpdate(user, { department });
                      }
                    }}
                  />
                </div>
                <select
                  className="role-select"
                  value={user.role}
                  disabled={pending}
                  aria-label={`${user.name}岗位角色`}
                  onChange={(event) =>
                    void onUpdate(user, {
                      role: event.target.value as UserRecord["role"],
                    })
                  }
                >
                  {roles.map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
                <div className="load-cell">
                  <span>负荷 {user.currentLoad}/8</span>
                  <i>
                    <b style={{ width: `${(user.currentLoad / 8) * 100}%` }} />
                  </i>
                </div>
                <button
                  className={user.active ? "active-user" : "inactive-user"}
                  disabled={pending}
                  onClick={() => void onUpdate(user, { active: !user.active })}
                >
                  {user.active ? "启用" : "停用"}
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="panel role-summary-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">角色配置</span>
              <h2>12 类岗位角色</h2>
            </div>
          </div>
          <div className="role-summary-list">
            {roles.map(([role, label]) => (
              <div key={role}>
                <span className="role-symbol">{label.slice(0, 1)}</span>
                <div>
                  <strong>{label}</strong>
                  <span>{permissionsByRole[role as keyof typeof permissionsByRole].length} 项权限</span>
                </div>
                <small>
                  {
                    snapshot.users.filter((user) => user.role === role).length
                  }
                  人
                </small>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="panel permission-matrix-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-kicker">Permission Matrix</span>
            <h2>关键权限矩阵</h2>
          </div>
          <span className="panel-note">✓ 允许 · — 只读/不允许</span>
        </div>
        <div className="data-table-wrap">
          <table className="permission-table">
            <thead>
              <tr>
                <th>角色</th>
                {matrixPermissions.map(([, label]) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map(([role, label]) => (
                <tr key={role}>
                  <td>{label}</td>
                  {matrixPermissions.map(([permission]) => (
                    <td key={permission}>
                      {permissionsByRole[
                        role as keyof typeof permissionsByRole
                      ].includes(permission) ? (
                        <span className="permission-yes">✓</span>
                      ) : (
                        <span className="permission-no">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ProjectDrawer({
  project,
  tab,
  setTab,
  milestones,
  issues,
  documents,
  formRecords,
  onClose,
  onEditForm,
  onResolveIssue,
  onCreateIssue,
  onUpdateMilestone,
  onWaiveMilestone,
  onProjectStatus,
  canUpdate,
  canClose,
  canTailor,
  canManageIssues,
  canEditForm,
  canUpload,
  onUploaded,
}: {
  project: Project;
  tab: string;
  setTab: (tab: string) => void;
  milestones: Milestone[];
  issues: Issue[];
  documents: WorkspaceSnapshot["documents"];
  formRecords: FormRecord[];
  onClose: () => void;
  onEditForm: (definition: FormDefinition) => void;
  onResolveIssue: (issue: Issue) => void;
  onCreateIssue: () => void;
  onUpdateMilestone: (milestone: Milestone) => void;
  onWaiveMilestone: (milestone: Milestone) => void;
  onProjectStatus: (mode: "pause" | "resume" | "terminate") => void;
  canUpdate: boolean;
  canClose: boolean;
  canTailor: boolean;
  canManageIssues: boolean;
  canEditForm: boolean;
  canUpload: boolean;
  onUploaded: () => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const tabs = [
    ["overview", "项目概览"],
    ["progress", "阶段进度"],
    ["forms", "表单记录"],
    ["issues", `问题（${issues.filter((issue) => issue.status === "open").length}）`],
    ["files", `文件（${documents.length}）`],
  ];

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("projectId", project.id);
    setUploading(true);
    try {
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "上传失败");
      form.reset();
      await onUploaded();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true">
      <button className="drawer-scrim" aria-label="关闭项目详情" onClick={onClose} />
      <aside className="project-drawer">
        <div className="drawer-header">
          <div>
            <div className="drawer-code-row">
              <span className="project-code simple">{project.code}</span>
              <span className={`risk-badge ${project.riskLevel}`}>
                {riskLabels[project.riskLevel]}
              </span>
              <span className={`status-chip ${project.status}`}>
                {statusLabels[project.status]}
              </span>
            </div>
            <h2>{project.name}</h2>
            <p>
              {project.productModel} · {project.customerName} ·{" "}
              {project.orderNo || "内部研发"}
            </p>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="drawer-tabs">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "is-active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="drawer-content">
          {tab === "overview" ? (
            <>
              {project.status !== "completed" &&
              project.status !== "cancelled" &&
              (canUpdate || canClose) ? (
                <div className="project-control-bar">
                  <span>项目状态控制</span>
                  <div>
                    {canUpdate ? (
                      <button
                        className="button small secondary"
                        onClick={() =>
                          onProjectStatus(
                            project.status === "paused" ? "resume" : "pause",
                          )
                        }
                      >
                        {project.status === "paused" ? "恢复项目" : "暂停项目"}
                      </button>
                    ) : null}
                    {canClose ? (
                      <button
                        className="button small danger"
                        onClick={() => onProjectStatus("terminate")}
                      >
                        终止项目
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <section className="drawer-summary-grid">
                <div>
                  <span>总体进度</span>
                  <strong>{project.progress}%</strong>
                  <div className="progress-track small">
                    <i
                      className={`progress-fill ${project.riskLevel}`}
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                </div>
                <div>
                  <span>当前阶段</span>
                  <strong>{project.stageLabel}</strong>
                  <small>下一节点 {formatDate(project.nextMilestoneDate)}</small>
                </div>
                <div>
                  <span>表单齐套</span>
                  <strong>{project.formCompletion}%</strong>
                  <small>{formRecords.length} 份记录已建立</small>
                </div>
                <div>
                  <span>预算执行</span>
                  <strong>
                    {project.budget
                      ? Math.round((project.spent / project.budget) * 100)
                      : 0}
                    %
                  </strong>
                  <small>
                    {formatCurrency(project.spent)} /{" "}
                    {formatCurrency(project.budget)}
                  </small>
                </div>
              </section>
              <section className="drawer-section">
                <h3>项目说明</h3>
                <p className="project-description">{project.description}</p>
                <dl className="detail-list">
                  <div>
                    <dt>项目类别</dt>
                    <dd>{project.category}</dd>
                  </div>
                  <div>
                    <dt>立项来源</dt>
                    <dd>{project.source}</dd>
                  </div>
                  <div>
                    <dt>电机编码</dt>
                    <dd>{project.motorCode || "待生成"}</dd>
                  </div>
                  <div>
                    <dt>项目负责人</dt>
                    <dd>{project.ownerName}</dd>
                  </div>
                  <div>
                    <dt>跟踪人</dt>
                    <dd>{project.trackerName}</dd>
                  </div>
                  <div>
                    <dt>计划周期</dt>
                    <dd>
                      {formatDate(project.plannedStart)} —{" "}
                      {formatDate(project.plannedEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt>目标单台成本</dt>
                    <dd>
                      {project.targetCost
                        ? `¥${project.targetCost.toLocaleString("zh-CN")}`
                        : "待核定"}
                    </dd>
                  </div>
                  <div>
                    <dt>订单交付</dt>
                    <dd>{project.orderNo || "不关联订单"}</dd>
                  </div>
                </dl>
              </section>
              <section className="drawer-section">
                <h3>阶段门概览</h3>
                <div className="mini-stage-track">
                  {milestones.map((milestone) => (
                    <div
                      key={milestone.id}
                      className={`mini-gate ${milestone.status}`}
                    >
                      <i />
                      <span>{gateLabels[milestone.gateCode]}</span>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : null}

          {tab === "progress" ? (
            <div className="milestone-list">
              {milestones.map((milestone, index) => (
                <div className={`milestone-row ${milestone.status}`} key={milestone.id}>
                  <div className="milestone-sequence">
                    <span>{index + 1}</span>
                    {index < milestones.length - 1 ? <i /> : null}
                  </div>
                  <div className="milestone-main">
                    <div className="milestone-title">
                      <div>
                        <h3>{milestone.name}</h3>
                        <span>{milestone.department}</span>
                      </div>
                      <span className={`status-chip ${milestone.status}`}>
                        {statusLabels[milestone.status]}
                      </span>
                    </div>
                    <div className="milestone-meta">
                      <span>责任人 {milestone.ownerName}</span>
                      <span>计划 {formatDate(milestone.plannedDate)}</span>
                      <span>证据 {milestone.evidenceCount} 项</span>
                      <span>
                        {milestone.requiredForm}
                        {milestone.gateCode === "planning" &&
                        project.category === "全新产品"
                          ? " + HD/JL-SJ-03A1"
                          : ""}
                      </span>
                    </div>
                    {milestone.note ? <p>{milestone.note}</p> : null}
                    <div className="milestone-progress">
                      <div className="progress-track small">
                        <i style={{ width: `${milestone.progress}%` }} />
                      </div>
                      <strong>{milestone.progress}%</strong>
                      <div className="milestone-actions">
                        {canUpdate &&
                        isOpenProject(project) &&
                        milestone.status !== "completed" &&
                        milestone.status !== "waived" ? (
                          <button onClick={() => onUpdateMilestone(milestone)}>
                            更新
                          </button>
                        ) : null}
                        {canTailor &&
                        isOpenProject(project) &&
                        project.category !== "全新产品" &&
                        !["initiation", "planning", "release"].includes(
                          milestone.gateCode,
                        ) &&
                        milestone.status !== "completed" &&
                        milestone.status !== "waived" ? (
                          <button
                            className="waive"
                            onClick={() => onWaiveMilestone(milestone)}
                          >
                            风险裁剪
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "forms" ? (
            <div className="drawer-form-list">
              {formDefinitions.map((definition) => {
                const record = formRecords.find(
                  (item) => item.formCode === definition.code,
                );
                return (
                  <div key={definition.code}>
                    <span className="form-card-number">{definition.shortCode}</span>
                    <div>
                      <strong>{definition.name}</strong>
                      <span>
                        {definition.stage} · {definition.ownerDepartment}
                      </span>
                    </div>
                    <span className={`status-chip ${record?.status || "not_started"}`}>
                      {record ? statusLabels[record.status] : "未开始"}
                    </span>
                    <button
                      onClick={() => onEditForm(definition)}
                    >
                      {!canEditForm || !isOpenProject(project)
                        ? "查看"
                        : record
                          ? "打开"
                          : "填写"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : null}

          {tab === "issues" ? (
            <>
              {canManageIssues &&
              project.status !== "completed" &&
              project.status !== "cancelled" ? (
                <div className="drawer-inline-toolbar">
                  <span>问题必须指定责任人、严重度和关闭期限</span>
                  <button className="button small primary" onClick={onCreateIssue}>
                    ＋ 新增问题
                  </button>
                </div>
              ) : null}
              <div className="drawer-issue-list">
                {issues.map((issue) => (
                  <article key={issue.id}>
                  <span className={`severity-box ${issue.severity}`}>!</span>
                  <div>
                    <div>
                      <span>{issue.category}</span>
                      <span className={`risk-badge ${issue.severity}`}>
                        {riskLabels[issue.severity]}
                      </span>
                      <span className={`status-chip ${issue.status}`}>
                        {statusLabels[issue.status]}
                      </span>
                    </div>
                    <h3>{issue.title}</h3>
                    <p>
                      责任人 {issue.ownerName} · 截止 {formatDate(issue.dueDate)}
                    </p>
                    {issue.resolution ? <blockquote>{issue.resolution}</blockquote> : null}
                  </div>
                  {issue.status === "open" && canManageIssues ? (
                    <button
                      className="button small secondary"
                      onClick={() => onResolveIssue(issue)}
                    >
                      关闭问题
                    </button>
                  ) : null}
                  </article>
                ))}
                {!issues.length ? <EmptyState text="暂无项目问题" /> : null}
              </div>
            </>
          ) : null}

          {tab === "files" ? (
            <>
              {canUpload ? (
                <form className="upload-zone" onSubmit={uploadFile}>
                  <div>
                    <strong>上传阶段证据或技术文件</strong>
                    <span>支持图纸、试验报告、会议记录与客户签署件，单文件 ≤ 25MB</span>
                  </div>
                  <select name="formCode" aria-label="关联表单">
                    <option value="">项目公共文件</option>
                    {formDefinitions.map((definition) => (
                      <option key={definition.code} value={definition.code}>
                        {definition.shortCode} {definition.name}
                      </option>
                    ))}
                  </select>
                  <input type="file" name="file" required />
                  <button className="button primary" disabled={uploading}>
                    {uploading ? "上传中…" : "上传文件"}
                  </button>
                </form>
              ) : null}
              <div className="document-list">
                {documents.map((document) => (
                  <a href={`/api/files/${document.id}`} key={document.id}>
                    <span className="document-type">
                      {document.fileName.split(".").at(-1)?.toUpperCase()}
                    </span>
                    <div>
                      <strong>{document.fileName}</strong>
                      <span>
                        {document.formCode || "项目公共文件"} · V{document.version} ·{" "}
                        {document.uploadedBy}
                      </span>
                    </div>
                    <small>{formatBytes(document.size)}</small>
                    <b>下载</b>
                  </a>
                ))}
                {!documents.length ? (
                  <EmptyState text="尚未上传文件，可将原始表单、图纸和验证报告归档到这里" />
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Modal({
  title,
  eyebrow,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="modal-layer" role="dialog" aria-modal="true">
      <button className="modal-scrim" onClick={onClose} aria-label="关闭对话框" />
      <div className={`modal-card ${wide ? "wide" : ""}`}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateProjectDialog({
  snapshot,
  pending,
  onClose,
  onSubmit,
}: {
  snapshot: WorkspaceSnapshot;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [customerId, setCustomerId] = useState(snapshot.customers[0]?.id || "");
  const [orderId, setOrderId] = useState("");
  const selectedOrder = snapshot.orders.find((order) => order.id === orderId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return onSubmit({
      name: form.get("name"),
      productModel: form.get("productModel"),
      category: form.get("category"),
      source: form.get("source"),
      customerId,
      orderId: orderId || null,
      plannedEnd: form.get("plannedEnd"),
      budget: Number(form.get("budget") || 0),
      priority: form.get("priority"),
      description: form.get("description"),
    });
  }
  return (
    <Modal eyebrow="Create Project" title="新建新品开发项目" onClose={onClose} wide>
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field full">
            <span>项目名称 *</span>
            <input name="name" placeholder="例如：高效率永磁同步电机平台" required />
          </label>
          <label className="field">
            <span>产品型号 *</span>
            <input name="productModel" placeholder="如 HE5-180M-4" required />
          </label>
          <label className="field">
            <span>项目类别 *</span>
            <select name="category" required>
              <option value="全新产品">全新产品</option>
              <option value="改进产品">改进产品</option>
              <option value="派生产品">派生产品</option>
            </select>
          </label>
          <label className="field">
            <span>立项来源 *</span>
            <select name="source" required>
              <option value="客户">客户</option>
              <option value="行业要求">行业要求</option>
              <option value="企业研发">企业研发</option>
            </select>
          </label>
          <label className="field">
            <span>客户 *</span>
            <select
              name="customerId"
              required
              value={customerId}
              disabled={Boolean(selectedOrder)}
              onChange={(event) => setCustomerId(event.target.value)}
            >
              {snapshot.customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.code} · {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>关联订单</span>
            <select
              name="orderId"
              value={orderId}
              onChange={(event) => {
                const nextOrderId = event.target.value;
                setOrderId(nextOrderId);
                const order = snapshot.orders.find(
                  (candidate) => candidate.id === nextOrderId,
                );
                if (order) setCustomerId(order.customerId);
              }}
            >
              <option value="">内部研发 / 暂不关联</option>
              {snapshot.orders
                .filter((order) => !order.projectId)
                .map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.orderNo} · {order.productModel}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>计划完成日期 *</span>
            <input
              name="plannedEnd"
              type="date"
              min={currentDateIso()}
              max={selectedOrder?.deliveryDate}
              required
            />
            {selectedOrder ? (
              <small>不得晚于订单交期 {formatDate(selectedOrder.deliveryDate)}</small>
            ) : null}
          </label>
          <label className="field">
            <span>开发预算（元）</span>
            <input name="budget" type="number" min="0" step="1000" />
          </label>
          <label className="field">
            <span>优先级</span>
            <select name="priority">
              <option value="normal">普通</option>
              <option value="high">高</option>
              <option value="urgent">紧急</option>
            </select>
          </label>
          <label className="field full">
            <span>项目说明 *</span>
            <textarea
              name="description"
              rows={4}
              placeholder="概述客户需求、主要技术目标和关键约束…"
              required
            />
          </label>
        </div>
        <div className="modal-footer">
          <p>创建后系统将自动生成 9 个阶段门和对应表单清单。</p>
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? "创建中…" : "创建并进入立项"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CreateOrderDialog({
  customers,
  pending,
  onClose,
  onSubmit,
}: {
  customers: WorkspaceSnapshot["customers"];
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return onSubmit({
      orderNo: form.get("orderNo"),
      customerId: form.get("customerId"),
      productModel: form.get("productModel"),
      quantity: Number(form.get("quantity") || 0),
      amount: Number(form.get("amount") || 0),
      currency: form.get("currency") || "CNY",
      deliveryDate: form.get("deliveryDate"),
    });
  }
  return (
    <Modal eyebrow="Sales Order" title="录入研发关联订单" onClose={onClose} wide>
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>订单号 *</span>
            <input name="orderNo" required placeholder="例如 SO-260901" />
          </label>
          <label className="field">
            <span>客户 *</span>
            <select name="customerId" required>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.code} · {customer.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            <span>产品型号 *</span>
            <input name="productModel" required placeholder="必须与待关联项目型号一致" />
          </label>
          <label className="field">
            <span>数量（台）*</span>
            <input name="quantity" type="number" min="1" step="1" required />
          </label>
          <label className="field">
            <span>订单金额 *</span>
            <input name="amount" type="number" min="0" step="0.01" required />
          </label>
          <label className="field">
            <span>币种</span>
            <select name="currency">
              <option value="CNY">人民币 CNY</option>
              <option value="USD">美元 USD</option>
              <option value="EUR">欧元 EUR</option>
            </select>
          </label>
          <label className="field">
            <span>订单交期 *</span>
            <input name="deliveryDate" type="date" required />
          </label>
        </div>
        <div className="modal-footer">
          <p>订单录入后可关联同型号项目；项目计划完成日不得晚于订单交期。</p>
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? "保存中…" : "保存订单"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OrderLinkDialog({
  order,
  projects,
  pending,
  onClose,
  onSubmit,
}: {
  order: SalesOrder;
  projects: Project[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (projectId: string) => Promise<void>;
}) {
  const candidates = projects.filter(
    (project) =>
      isOpenProject(project) &&
      !project.orderId &&
      project.productModel === order.productModel &&
      project.plannedEnd <= order.deliveryDate,
  );
  const [projectId, setProjectId] = useState(candidates[0]?.id || "");
  return (
    <Modal
      eyebrow={`${order.orderNo} · ${order.customerName}`}
      title="关联新品开发项目"
      onClose={onClose}
    >
      <div className="decision-summary">
        <strong>{order.productModel} · {order.quantity} 台</strong>
        <span>
          订单交期 {formatDate(order.deliveryDate)} ·{" "}
          {formatCurrency(order.amount, order.currency)}
        </span>
        <p>仅列出型号一致、尚未关联订单且计划完成日不晚于订单交期的项目。</p>
      </div>
      <label className="field decision-comment">
        <span>选择项目 *</span>
        <select
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          disabled={!candidates.length}
        >
          {candidates.map((project) => (
            <option key={project.id} value={project.id}>
              {project.code} · {project.name} · 计划 {formatDate(project.plannedEnd)}
            </option>
          ))}
        </select>
        {!candidates.length ? (
          <small>没有满足型号与交期约束的候选项目，请先新建或调整项目。</small>
        ) : null}
      </label>
      <div className="modal-footer">
        <p>关联后项目客户将以订单客户为准，并纳入交付风险监控。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={pending || !projectId}
          onClick={() => onSubmit(projectId)}
        >
          {pending ? "关联中…" : "确认关联"}
        </button>
      </div>
    </Modal>
  );
}

function FormEditorDialog({
  definition,
  project,
  record,
  pending,
  canSubmit,
  readOnly,
  onClose,
  onSave,
}: {
  definition: FormDefinition;
  project?: Project;
  record?: FormRecord;
  pending: boolean;
  canSubmit: boolean;
  readOnly: boolean;
  onClose: () => void;
  onSave: (
    payload: Record<string, string | number | boolean>,
    submit: boolean,
  ) => Promise<void>;
}) {
  const [payload, setPayload] = useState<
    Record<string, string | number | boolean>
  >(record?.payload || {});

  function updateValue(key: string, value: string | number | boolean) {
    setPayload((current) => ({ ...current, [key]: value }));
  }

  const missingRequired = definition.fields.filter(
    (field) => field.required && !payload[field.key],
  ).length;

  return (
    <Modal
      eyebrow={`${definition.code} · ${definition.stage}`}
      title={definition.name}
      onClose={onClose}
      wide
    >
      <div className="form-editor-context">
        <div>
          <span>当前项目</span>
          <strong>
            {project?.code} · {project?.name}
          </strong>
        </div>
        <div>
          <span>主责部门</span>
          <strong>{definition.ownerDepartment}</strong>
        </div>
        <div>
          <span>审批角色</span>
          <strong>{definition.approver}</strong>
        </div>
        <span className={`status-chip ${record?.status || "draft"}`}>
          {record ? `V${record.version} · ${statusLabels[record.status]}` : "新记录"}
        </span>
      </div>
      <form
        className="modal-form form-editor-body"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="form-grid">
          {definition.fields.map((field) => (
            <label
              className={`field ${field.span === "full" ? "full" : ""}`}
              key={field.key}
            >
              <span>
                {field.label}
                {field.required ? " *" : ""}
              </span>
              {field.type === "textarea" ? (
                <textarea
                  disabled={readOnly}
                  rows={4}
                  value={String(payload[field.key] || "")}
                  placeholder={field.hint}
                  onChange={(event) => updateValue(field.key, event.target.value)}
                />
              ) : field.type === "select" ? (
                <select
                  disabled={readOnly}
                  value={String(payload[field.key] || "")}
                  onChange={(event) => updateValue(field.key, event.target.value)}
                >
                  <option value="">请选择</option>
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === "multiselect" ? (
                <select
                  multiple
                  disabled={readOnly}
                  value={String(payload[field.key] || "")
                    .split("、")
                    .filter(Boolean)}
                  onChange={(event) =>
                    updateValue(
                      field.key,
                      Array.from(event.target.selectedOptions)
                        .map((option) => option.value)
                        .join("、"),
                    )
                  }
                >
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === "checkbox" ? (
                <span className="check-field">
                  <input
                    type="checkbox"
                    disabled={readOnly}
                    checked={Boolean(payload[field.key])}
                    onChange={(event) =>
                      updateValue(field.key, event.target.checked)
                    }
                  />
                  是，已确认并具备记录
                </span>
              ) : (
                <input
                  type={field.type}
                  disabled={readOnly}
                  value={
                    typeof payload[field.key] === "boolean"
                      ? ""
                      : String(payload[field.key] || "")
                  }
                  placeholder={field.hint}
                  onChange={(event) =>
                    updateValue(
                      field.key,
                      field.type === "number"
                        ? Number(event.target.value)
                        : event.target.value,
                    )
                  }
                />
              )}
              {field.hint && field.type !== "textarea" ? (
                <small>{field.hint}</small>
              ) : null}
            </label>
          ))}
        </div>
      </form>
      <div className="modal-footer sticky">
        <p>
          {readOnly
            ? "当前记录为只读模式"
            : missingRequired
            ? `仍有 ${missingRequired} 个必填项未完成`
            : "必填项已完成，可保存或提交审批"}
        </p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        {!readOnly ? (
          <>
            <button
              className="button secondary strong"
              disabled={pending}
              onClick={() => onSave(payload, false)}
            >
              保存草稿
            </button>
            <button
              className="button primary"
              disabled={pending || missingRequired > 0 || !canSubmit}
              onClick={() => onSave(payload, true)}
            >
              提交审批
            </button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function CreateChangeDialog({
  projects,
  pending,
  onClose,
  onSubmit,
}: {
  projects: Project[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return onSubmit({
      projectId: form.get("projectId"),
      changeType: form.get("changeType"),
      title: form.get("title"),
      reason: form.get("reason"),
      affectedObject: form.get("affectedObject"),
      supplierNotice: form.get("supplierNotice") === "on",
      customerNotice: form.get("customerNotice") === "on",
      disposition: form.get("disposition"),
      dueDate: form.get("dueDate"),
    });
  }
  return (
    <Modal eyebrow="Engineering Change" title="发起文件 / 图纸变更" onClose={onClose} wide>
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field">
            <span>关联项目 *</span>
            <select name="projectId" required>
              {projects
                .filter((project) => project.status !== "cancelled")
                .map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} · {project.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>变更性质 *</span>
            <select name="changeType" required>
              <option>临时更改</option>
              <option>更改图纸</option>
              <option>更改CAXA</option>
              <option>工艺变更</option>
              <option>客户要求变更</option>
            </select>
          </label>
          <label className="field full">
            <span>变更标题 *</span>
            <input name="title" required placeholder="用一句话说明变更内容" />
          </label>
          <label className="field full">
            <span>更改原因 *</span>
            <textarea name="reason" rows={4} required />
          </label>
          <label className="field">
            <span>影响对象 *</span>
            <input
              name="affectedObject"
              required
              placeholder="图号、文件编号、零件或BOM"
            />
          </label>
          <label className="field">
            <span>完成期限 *</span>
            <input name="dueDate" type="date" required />
          </label>
          <label className="field">
            <span>旧件处置</span>
            <select name="disposition">
              <option>待评估</option>
              <option>报废</option>
              <option>用完止</option>
              <option>返修</option>
              <option>其他</option>
            </select>
          </label>
          <div className="field checkbox-group">
            <span>外部通知</span>
            <label>
              <input name="supplierNotice" type="checkbox" /> 通知供应商
            </label>
            <label>
              <input name="customerNotice" type="checkbox" /> 通知客户
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <p>提交后将生成 ECN 编号并进入校对、会签和审批流程。</p>
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? "提交中…" : "提交变更评审"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DecisionDialog({
  approval,
  decision,
  pending,
  onClose,
  onSubmit,
}: {
  approval: Approval;
  decision: "approved" | "rejected";
  pending: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState(
    decision === "approved" ? "资料齐套，同意进入下一阶段。" : "",
  );
  return (
    <Modal
      eyebrow={`${approval.projectCode} · ${approval.formCode}`}
      title={decision === "approved" ? "确认审批通过" : "退回补充资料"}
      onClose={onClose}
    >
      <div className="decision-summary">
        <strong>{approval.title}</strong>
        <span>
          {approval.projectName} · {approval.submitterName} 提交
        </span>
        <p>{approval.comment}</p>
      </div>
      <label className="field decision-comment">
        <span>审批意见 *</span>
        <textarea
          rows={5}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={
            decision === "approved"
              ? "填写通过依据或后续要求"
              : "说明需要补充或修改的具体内容"
          }
        />
      </label>
      <div className="modal-footer">
        <p>审批结论将写入质量记录和审计日志，不能静默修改。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className={decision === "approved" ? "button primary" : "button danger"}
          disabled={pending || !comment.trim()}
          onClick={() => onSubmit(comment)}
        >
          {pending
            ? "处理中…"
            : decision === "approved"
              ? "确认通过"
              : "确认退回"}
        </button>
      </div>
    </Modal>
  );
}

function ChangeDecisionDialog({
  change,
  decision,
  pending,
  onClose,
  onSubmit,
}: {
  change: ChangeRequest;
  decision: "approved" | "rejected";
  pending: boolean;
  onClose: () => void;
  onSubmit: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState(
    decision === "approved"
      ? "影响分析、通知范围和旧件处置明确，同意执行。"
      : "",
  );
  return (
    <Modal
      eyebrow={`${change.changeNo} · ${change.projectCode}`}
      title={decision === "approved" ? "批准工程变更" : "退回工程变更"}
      onClose={onClose}
    >
      <div className="decision-summary">
        <strong>{change.title}</strong>
        <span>
          {change.projectName} · {change.changeType}
        </span>
        <p>{change.reason}</p>
      </div>
      <label className="field decision-comment">
        <span>评审意见 *</span>
        <textarea
          rows={5}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={
            decision === "approved"
              ? "说明批准依据、实施与验证要求"
              : "说明需补充的影响分析或处置要求"
          }
        />
      </label>
      <div className="modal-footer">
        <p>结论将进入项目审计轨迹，相关图纸和文件仍需按受控流程换版。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className={decision === "approved" ? "button primary" : "button danger"}
          disabled={pending || !comment.trim()}
          onClick={() => onSubmit(comment)}
        >
          {pending
            ? "处理中…"
            : decision === "approved"
              ? "确认批准"
              : "确认退回"}
        </button>
      </div>
    </Modal>
  );
}

function ChangeVerificationDialog({
  change,
  pending,
  onClose,
  onSubmit,
}: {
  change: ChangeRequest;
  pending: boolean;
  onClose: () => void;
  onSubmit: (verification: string) => Promise<void>;
}) {
  const [verification, setVerification] = useState("");
  return (
    <Modal
      eyebrow={`${change.changeNo} · ${change.projectCode}`}
      title="变更实施与效果验证"
      onClose={onClose}
    >
      <div className="decision-summary">
        <strong>{change.title}</strong>
        <span>
          影响对象：{change.affectedObject} · 旧件处置：{change.disposition}
        </span>
        <p>
          {change.customerNotice ? "需确认客户已收到通知；" : ""}
          {change.supplierNotice ? "需确认供应商已收到通知；" : ""}
          同时确认图纸、BOM、工艺、检验文件及系统版本已同步。
        </p>
      </div>
      <label className="field decision-comment">
        <span>实施与验证结果 *</span>
        <textarea
          rows={6}
          value={verification}
          onChange={(event) => setVerification(event.target.value)}
          placeholder="说明实施日期、影响批次、库存处置、验证证据和最终结论…"
        />
      </label>
      <div className="modal-footer">
        <p>完成后变更进入“已验证归档”，实施记录保留在项目审计轨迹中。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={pending || !verification.trim()}
          onClick={() => onSubmit(verification)}
        >
          {pending ? "归档中…" : "确认验证并归档"}
        </button>
      </div>
    </Modal>
  );
}

function MilestoneUpdateDialog({
  milestone,
  project,
  pending,
  onClose,
  onSubmit,
}: {
  milestone: Milestone;
  project?: Project;
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    status: "not_started" | "in_progress" | "blocked" | "completed";
    progress: number;
    note: string;
    plannedDate: string;
  }) => Promise<void>;
}) {
  const [status, setStatus] = useState<
    "not_started" | "in_progress" | "blocked" | "completed"
  >(milestone.status === "waived" ? "not_started" : milestone.status);
  const [progress, setProgress] = useState(milestone.progress);
  const [plannedDate, setPlannedDate] = useState(milestone.plannedDate);
  const [note, setNote] = useState(milestone.note);

  function changeStatus(nextStatus: typeof status) {
    setStatus(nextStatus);
    if (nextStatus === "completed") setProgress(100);
    if (nextStatus === "not_started") setProgress(0);
  }

  return (
    <Modal
      eyebrow={`${milestone.requiredForm} · ${milestone.department}`}
      title={`更新阶段：${milestone.name}`}
      onClose={onClose}
    >
      <div className="form-grid modal-form">
        <label className="field">
          <span>阶段状态 *</span>
          <select
            value={status}
            onChange={(event) =>
              changeStatus(event.target.value as typeof status)
            }
          >
            <option value="not_started">未开始</option>
            <option value="in_progress">进行中</option>
            <option value="blocked">受阻</option>
            <option value="completed">完成并申请放行</option>
          </select>
        </label>
        <label className="field">
          <span>计划完成日 *</span>
          <input
            type="date"
            value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
          />
        </label>
        <label className="field full">
          <span>完成度：{progress}%</span>
          <input
            type="range"
            min="0"
            max="100"
            value={progress}
            disabled={status === "completed" || status === "not_started"}
            onChange={(event) => setProgress(Number(event.target.value))}
          />
        </label>
        <label className="field full">
          <span>进展、阻塞原因或放行说明 *</span>
          <textarea
            rows={5}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="说明已完成工作、待解决事项、责任人和下一步…"
          />
        </label>
      </div>
      <div className="gate-check-note">
        标记完成时，系统将校验前序关口、{milestone.requiredForm}
        {milestone.gateCode === "planning" && project?.category === "全新产品"
          ? " 与 HD/JL-SJ-03A1"
          : ""}
        已批准状态及必要验证附件。
      </div>
      <div className="modal-footer">
        <p>受阻状态会自动提升项目风险，并进入管理工作台。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={pending || !plannedDate || !note.trim()}
          onClick={() => onSubmit({ status, progress, note, plannedDate })}
        >
          {pending ? "保存中…" : "保存阶段进度"}
        </button>
      </div>
    </Modal>
  );
}

function MilestoneWaiverDialog({
  milestone,
  pending,
  onClose,
  onSubmit,
}: {
  milestone: Milestone;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      eyebrow={`${milestone.requiredForm} · 派生/改进产品流程裁剪`}
      title={`裁剪阶段：${milestone.name}`}
      onClose={onClose}
    >
      <div className="decision-summary">
        <strong>本操作不适用于全新产品</strong>
        <span>批准后该阶段按“已裁剪”计入流程进度，但不会生成虚假的表单记录。</span>
        <p>
          应说明与原型产品的等同性、风险分析、验证替代证据，以及为何不影响功能、法规、安全和客户要求。
        </p>
      </div>
      <label className="field decision-comment">
        <span>风险依据与批准意见 *</span>
        <textarea
          rows={6}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="例如：仅调整安装尺寸，电磁方案、材料体系及型式试验边界不变；已完成接口复核…"
        />
      </label>
      <div className="modal-footer">
        <p>裁剪决定将记录批准人、日期和原因，并保留在项目审计轨迹。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button danger"
          disabled={pending || reason.trim().length < 12}
          onClick={() => onSubmit(reason)}
        >
          {pending ? "处理中…" : "确认风险裁剪"}
        </button>
      </div>
    </Modal>
  );
}

function ProjectStatusDialog({
  project,
  mode,
  pending,
  onClose,
  onSubmit,
}: {
  project: Project;
  mode: "pause" | "resume" | "terminate";
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const isTerminate = mode === "terminate";
  const title =
    mode === "pause"
      ? "暂停项目"
      : mode === "resume"
        ? "恢复项目"
        : "终止项目";
  return (
    <Modal eyebrow={`${project.code} · ${project.orderNo || "内部研发"}`} title={title} onClose={onClose}>
      <div className="decision-summary">
        <strong>{project.name}</strong>
        <span>
          当前阶段：{project.stageLabel} · 总体进度：{project.progress}%
        </span>
        <p>
          {isTerminate
            ? "终止后未完成阶段将标记受阻，所有待审批事项自动关闭；订单关联和既有资料继续保留用于追溯。"
            : mode === "pause"
              ? "暂停期间项目不计入在研负荷，但里程碑、订单和问题记录继续保留。"
              : "恢复后项目重新进入在研组合，原有计划和风险仍然有效。"}
        </p>
      </div>
      <label className="field decision-comment">
        <span>{isTerminate ? "终止原因、订单影响与资料处置 *" : "状态变更说明 *"}</span>
        <textarea
          rows={6}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={
            isTerminate
              ? "说明客户/订单影响、已完成成果、物料和文件处置、相关部门通知…"
              : "说明原因、预计影响和后续安排…"
          }
        />
      </label>
      <div className="modal-footer">
        <p>状态变化和说明将写入不可静默修改的项目审计轨迹。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className={isTerminate ? "button danger" : "button primary"}
          disabled={
            pending || reason.trim().length < (isTerminate ? 12 : 4)
          }
          onClick={() => onSubmit(reason)}
        >
          {pending ? "处理中…" : `确认${title}`}
        </button>
      </div>
    </Modal>
  );
}

function CreateIssueDialog({
  project,
  users,
  pending,
  onClose,
  onSubmit,
}: {
  project: Project;
  users: UserRecord[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return onSubmit({
      projectId: project.id,
      title: form.get("title"),
      category: form.get("category"),
      severity: form.get("severity"),
      ownerId: form.get("ownerId"),
      dueDate: form.get("dueDate"),
    });
  }
  return (
    <Modal eyebrow={project.code} title="新增项目问题" onClose={onClose} wide>
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field full">
            <span>问题标题 *</span>
            <input name="title" required placeholder="清楚描述偏差、风险或阻塞事项" />
          </label>
          <label className="field">
            <span>问题类别 *</span>
            <select name="category" required>
              <option>技术</option>
              <option>工艺</option>
              <option>质量</option>
              <option>供应链</option>
              <option>制造</option>
              <option>客户现场</option>
              <option>进度</option>
              <option>成本</option>
            </select>
          </label>
          <label className="field">
            <span>严重程度 *</span>
            <select name="severity" required>
              <option value="low">低风险</option>
              <option value="medium">中风险</option>
              <option value="high">高风险</option>
              <option value="critical">严重风险</option>
            </select>
          </label>
          <label className="field">
            <span>责任人 *</span>
            <select name="ownerId" required>
              {users
                .filter((user) => user.active)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name} · {user.department}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>关闭期限 *</span>
            <input name="dueDate" type="date" required />
          </label>
        </div>
        <div className="modal-footer">
          <p>高风险问题会自动提升项目风险等级，并在工作台优先显示。</p>
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button className="button primary" disabled={pending}>
            {pending ? "创建中…" : "建立问题"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResolveIssueDialog({
  issue,
  pending,
  onClose,
  onSubmit,
}: {
  issue: Issue;
  pending: boolean;
  onClose: () => void;
  onSubmit: (resolution: string) => Promise<void>;
}) {
  const [resolution, setResolution] = useState("");
  return (
    <Modal
      eyebrow={`${issue.projectCode} · ${issue.category}`}
      title="关闭问题并记录措施"
      onClose={onClose}
    >
      <div className="decision-summary">
        <span className={`risk-badge ${issue.severity}`}>
          {riskLabels[issue.severity]}
        </span>
        <strong>{issue.title}</strong>
        <span>
          责任人 {issue.ownerName} · 截止 {formatDate(issue.dueDate)}
        </span>
      </div>
      <label className="field decision-comment">
        <span>解决措施与验证结果 *</span>
        <textarea
          rows={6}
          value={resolution}
          onChange={(event) => setResolution(event.target.value)}
          placeholder="说明原因、采取的措施、验证证据和结论…"
        />
      </label>
      <div className="modal-footer">
        <p>关闭后仍保留原问题、责任人与完整处理记录。</p>
        <button className="button secondary" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          disabled={pending || !resolution.trim()}
          onClick={() => onSubmit(resolution)}
        >
          {pending ? "处理中…" : "验证并关闭"}
        </button>
      </div>
    </Modal>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <span>□</span>
      <p>{text}</p>
    </div>
  );
}

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatCurrency(value: number, currency = "CNY") {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function daysUntil(value: string) {
  const target = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const today = new Date(`${currentDateIso()}T00:00:00Z`);
  return Math.max(0, Math.ceil((target.getTime() - today.getTime()) / 86400000));
}

function currentDateIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fullDateLabel() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date()),
  );
  if (hour < 6) return "夜深了";
  if (hour < 12) return "上午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function isOpenProject(project: Project) {
  return project.status === "active" || project.status === "planning";
}

function initials(value: string) {
  return value.trim().slice(-2);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(value: string) {
  const day = value.slice(5, 10).replace("-", "月");
  const time = value.slice(11, 16);
  return `${day}日 ${time}`;
}
