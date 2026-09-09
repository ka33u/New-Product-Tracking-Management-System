"use client";

import { useRef, useState } from "react";
import { evidenceStageStatus, motorTestIssues, targetInspectionEvidence } from "../../../lib/evidence-checks";
import { RevisionDetail } from "./RevisionDetail";
import { ReadOnlyForm } from "./ReadOnlyForm";
import { SignOutControl } from "./SignOutControl";
import { OwnerTransferDialog } from "./OwnerTransferDialog";
import { ConfirmMotorDialog, MotorProductionPanel } from "./MotorProduction";
import { canEditSheet, canManageProjectLifecycle, isProjectSteward } from "../../../lib/access-v2";
import { formDefinitions, formReleaseIssues } from "../../../lib/forms";
import type { NpdProject, NpdUser, NpdWorkspaceSnapshot, ProjectMotor, SheetCode } from "../../../lib/npd-v2";
import { documentKindLabel, motorProductionLabel, partStatusLabel, projectStatusLabels, sheetStatusLabels } from "../../../lib/npd-v2";
import { sheetByCode } from "../../../lib/sheets-v2";
import { StageAssignmentNotice } from "./StageAssignmentNotice";
import {
  ConfirmPartDialog,
  ControlledFormDialog,
  InspectionDialog,
  MemberDialog,
  MotorDialog,
  PartDialog,
  ProjectStatusDialog,
  SheetDialog,
  TestReportDialog,
  type RunAction,
  type UploadFile,
} from "./Dialogs";
import { EmptyState, formatDate, formatDateTime, Icon, ProgressBar, StatusBadge } from "./ui";

type DialogState =
  | { kind: "motor"; motor?: ProjectMotor }
  | { kind: "form"; formCode: string }
  | { kind: "view_form"; formCode: string }
  | { kind: "sheet"; sheetCode: SheetCode }
  | { kind: "part"; partId?: string }
  | { kind: "confirm_part"; partId: string }
  | { kind: "confirm_motor"; motorId: string }
  | { kind: "test" }
  | { kind: "inspection" }
  | { kind: "member" }
  | { kind: "status" }
  | { kind: "owner_transfer" }
  | null;

export function ProjectWorkspace({ project, snapshot, currentUser, signOutPath, onBack, onAction, onUpload }: { project: NpdProject; snapshot: NpdWorkspaceSnapshot; currentUser: NpdUser; signOutPath: string; onBack: () => void; onAction: RunAction; onUpload: UploadFile }) {
  const [active, setActive] = useState<"overview" | SheetCode>("overview");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<{ sheetCode: SheetCode; fileName: string; message: string } | null>(null);
  const uploadPending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const motors = snapshot.motors.filter((item) => item.projectId === project.id);
  const sheets = snapshot.sheets.filter((item) => item.projectId === project.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const parts = snapshot.parts.filter((item) => item.projectId === project.id);
  const activities = snapshot.activities.filter((item) => item.projectId === project.id);
  const steward = isProjectSteward(currentUser, project);
  const activeSheet = active === "overview" ? null : sheets.find((item) => item.code === active);
  const editable = active !== "overview" && canEditSheet(currentUser, project, active);

  const uploadGeneral = async (file: File) => {
    if (active === "overview" || !editable || uploadPending.current) return;
    // A ref also guards repeated callbacks before React has rendered disabled=true.
    uploadPending.current = true;
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(file, { projectId: project.id, sheetCode: active, kind: "stage_attachment" });
    } catch (error) {
      setUploadError({ sheetCode: active, fileName: file.name, message: error instanceof Error ? error.message : "附件上传失败。" });
    } finally {
      uploadPending.current = false;
      setUploading(false);
      // Permit selecting the same local file again; never automatically retry a write.
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const exportBase = `/api/export/project/${project.id}`;

  return <div className="npd2-project-shell">
    <div className="npd2-project-account"><span>当前账户：<b>{currentUser.name}</b> · {currentUser.roleLabel}</span><SignOutControl path={signOutPath} className="npd2-button npd2-button-ghost" /></div>
    <ProjectReadOnlyNotice project={project} currentUser={currentUser} />
    <header className="npd2-project-header"><div className="npd2-project-header-main"><button className="npd2-back" onClick={onBack}><Icon name="back" />返回项目列表</button><div className="npd2-project-title-row"><div className="npd2-project-emblem">{project.seriesName.slice(0, 2)}</div><div><div className="npd2-title-meta"><span>{project.code}</span><StatusBadge value={project.status} label={projectStatusLabels[project.status]} />{project.overdueDays > 0 && <span className="npd2-overdue"><Icon name="alert" />逾期 {project.overdueDays} 天</span>}</div><h1>{project.name}</h1><p>{project.seriesName} · {project.customerName} · {motors.length} 个具体电机规格</p></div></div></div><div className="npd2-project-header-actions"><a className="npd2-button npd2-button-soft" href={`${exportBase}?format=excel`}><Icon name="export" />完整 Excel</a><a className="npd2-button npd2-button-primary" href={`${exportBase}?format=archive`}><Icon name="file" />程序 Word</a><a className="npd2-button npd2-button-primary" href={`${exportBase}?format=bundle`} title="含Word、Excel及全部附件原件，未加密，请妥善保管"><Icon name="export" />离线归档 ZIP</a><ProjectLifecycleControl project={project} currentUser={currentUser} onOpen={() => setDialog({ kind: "status" })} /></div></header>
    <div className="npd2-project-kpis"><span><small>项目负责人</small><b>{project.ownerName}</b></span><span><small>发起人</small><b>{project.initiatorName}</b></span><span><small>计划周期</small><b>{formatDate(project.plannedStart)} — {formatDate(project.plannedEnd)}</b></span><span><small>当前阶段</small><b>{project.currentSheetTitle}</b></span><span className="npd2-project-progress"><small>总体进度 <b>{project.progress}%</b></small><ProgressBar value={project.progress} /></span></div>
    <nav className="npd2-sheet-tabs" aria-label="项目阶段 Sheet"><button className={active === "overview" ? "active" : ""} onClick={() => setActive("overview")}><span className="npd2-tab-index"><Icon name="grid" /></span><b>项目概览</b><small>规格与动态</small></button>{sheets.map((sheet) => <button key={sheet.id} className={`${active === sheet.code ? "active" : ""} ${sheet.status === "completed" ? "done" : ""}`} onClick={() => setActive(sheet.code)}><span className="npd2-tab-index">{sheet.sortOrder}</span><b>{sheetByCode[sheet.code].shortTitle}</b><small>{sheetStatusLabels[sheet.status]} · {sheet.progress}%</small></button>)}</nav>
    {uploadError && <p className="npd2-stage-note blocked" role="alert">{sheetByCode[uploadError.sheetCode].shortTitle} · 附件“{uploadError.fileName}”：{uploadError.message} 请先核对该阶段附件列表；如未上传成功，处理提示的问题后重新选择本机原文件。系统不会自动重传。</p>}
    <main className="npd2-project-content">{active === "overview" ? <Overview project={project} snapshot={snapshot} currentUser={currentUser} motors={motors} activities={activities} steward={steward} onDialog={setDialog} /> : activeSheet && <SheetContent project={project} snapshot={snapshot} currentUser={currentUser} sheetCode={active} editable={editable} onDialog={setDialog} />}</main>
    {activeSheet && <aside className="npd2-sheet-toolbar"><div><i style={{ background: sheetByCode[activeSheet.code].color }} /><span>Sheet {activeSheet.sortOrder}</span><b>{activeSheet.title}</b><StatusBadge value={activeSheet.status} label={sheetStatusLabels[activeSheet.status]} /></div><div><a className="npd2-button npd2-button-ghost" href={`${exportBase}?format=sheet&sheet=${activeSheet.code}`}><Icon name="export" />导出本 Sheet</a>{editable && <><input ref={fileInput} className="npd2-hidden-input" type="file" onChange={(event) => event.target.files?.[0] && uploadGeneral(event.target.files[0])} /><button className="npd2-button npd2-button-soft" disabled={uploading} onClick={() => fileInput.current?.click()}><Icon name="upload" />{uploading ? "上传中…" : "上传附件"}</button><button className="npd2-button npd2-button-primary" onClick={() => setDialog({ kind: "sheet", sheetCode: activeSheet.code })}><Icon name="edit" />更新阶段</button></>}</div></aside>}
    {dialog?.kind === "motor" && <MotorDialog project={project} motor={dialog.motor} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "confirm_motor" && <ConfirmMotorDialog motor={motors.find((item) => item.id === dialog.motorId)!} sheetVersion={sheets.find((item) => item.code === "parts_plan")!.version} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "form" && <ControlledFormDialog project={project} formCode={dialog.formCode} record={snapshot.formRecords.find((item) => item.projectId === project.id && item.formCode === dialog.formCode)} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "view_form" && <ReadOnlyForm projectCode={project.code} formCode={dialog.formCode} record={snapshot.formRecords.find((item) => item.projectId === project.id && item.formCode === dialog.formCode)} onClose={() => setDialog(null)} />}
    {dialog?.kind === "sheet" && <SheetDialog project={project} sheet={sheets.find((item) => item.code === dialog.sheetCode)!} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "part" && <PartDialog project={project} motors={motors} part={parts.find((item) => item.id === dialog.partId)} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "confirm_part" && <ConfirmPartDialog part={parts.find((item) => item.id === dialog.partId)!} sheetVersion={snapshot.sheets.find((item) => item.projectId === project.id && item.code === "parts_plan")!.version} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "test" && <TestReportDialog project={project} motors={motors} onClose={() => setDialog(null)} onAction={onAction} onUpload={onUpload} />}
    {dialog?.kind === "inspection" && <InspectionDialog project={project} motors={motors} parts={parts} onClose={() => setDialog(null)} onAction={onAction} onUpload={onUpload} />}
    {dialog?.kind === "member" && <MemberDialog project={project} snapshot={snapshot} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "status" && <ProjectStatusDialog project={project} onClose={() => setDialog(null)} onAction={onAction} />}
    {dialog?.kind === "owner_transfer" && <OwnerTransferDialog project={project} snapshot={snapshot} onClose={() => setDialog(null)} onAction={onAction} />}
  </div>;
}

function ProjectReadOnlyNotice({ project, currentUser }: { project: NpdProject; currentUser: NpdUser }) {
  if (project.status === "paused") return <p className="npd2-stage-note blocked" role="status">项目已暂停：可查看和导出，暂不可修改。{canManageProjectLifecycle(currentUser, project) ? "请通过右上方“项目状态”填写恢复依据后继续。" : "请联系项目负责人、发起人或管理员确认恢复。"}</p>;
  if (["completed", "cancelled"].includes(project.status) && currentUser.role !== "admin") return <p className="npd2-stage-note" role="status">项目{projectStatusLabels[project.status]}：当前为只读，可查看历史和导出资料。如需更改或重新开发，请联系管理员处理。</p>;
  return null;
}

function ProjectLifecycleControl({ project, currentUser, onOpen }: { project: NpdProject; currentUser: NpdUser; onOpen: () => void }) {
  if (!canManageProjectLifecycle(currentUser, project)) return null;
  return <button className="npd2-icon-button" onClick={onOpen} title="项目状态" aria-label="项目状态"><Icon name="settings" /></button>;
}

function Overview({ project, snapshot, currentUser, motors, activities, steward, onDialog }: { project: NpdProject; snapshot: NpdWorkspaceSnapshot; currentUser: NpdUser; motors: ProjectMotor[]; activities: NpdWorkspaceSnapshot["activities"]; steward: boolean; onDialog: (dialog: DialogState) => void }) {
  const canMaintain = canEditSheet(currentUser, project, "input_output");
  const members = snapshot.members.filter((item) => item.projectId === project.id);
  const parts = snapshot.parts.filter((item) => item.projectId === project.id);
  const tests = snapshot.testReports.filter((item) => item.projectId === project.id);
  const inspections = snapshot.inspections.filter((item) => item.projectId === project.id);
  return <div className="npd2-overview-grid"><div className="npd2-overview-main"><article className="npd2-panel"><div className="npd2-panel-title"><div><h2>同系列电机规格</h2><p>每个规格独立关联设计输出、检验要求、试验要求和完成节点</p></div>{steward && canMaintain && <button className="npd2-button npd2-button-soft" onClick={() => onDialog({ kind: "motor" })}><Icon name="plus" />增加规格</button>}</div><div className="npd2-motor-cards">{motors.map((motor) => <div className="npd2-motor-card" key={motor.id}><div className="npd2-motor-card-head"><span><Icon name="motor" /></span><div><b>{motor.model}</b><small>设计版次 R{motor.designRevision}</small></div><StatusBadge value={motor.status} label={motorProductionLabel(motor)} /></div><div className="npd2-motor-specs"><span><small>额定功率</small><b>{motor.ratedPower || "—"}</b></span><span><small>电压 / 频率</small><b>{motor.voltage || "—"} / {motor.frequency || "—"}</b></span><span><small>极数 / 机座</small><b>{motor.poles || "—"} / {motor.frameSize || "—"}</b></span><span><small>出线 / 防护</small><b>{motor.terminalMode || "—"} / {motor.protectionGrade || "—"}</b></span><span><small>绝缘 / 冷却</small><b>{motor.insulationClass || "—"} / {motor.coolingMethod || "—"}</b></span><span><small>数量 / 节点</small><b>{motor.quantity} 台 / {motor.plannedDate}</b></span></div><div className="npd2-requirement"><small>检验要求</small><p>{motor.inspectionRequirement || "尚未配置"}</p><small>试验要求</small><p>{motor.testRequirement || "尚未配置"}</p></div>{canMaintain && <button className="npd2-text-button" onClick={() => onDialog({ kind: "motor", motor })}><Icon name="edit" />变更规格与设计输出</button>}</div>)}</div></article><article className="npd2-panel"><div className="npd2-panel-title"><div><h2>项目交付完整度</h2><p>设计、生产、试验、质量交付物总览</p></div></div><div className="npd2-delivery-grid"><Delivery icon="folder" label="零部件节点" value={parts.filter((item) => item.status === "completed").length} total={parts.length} /><Delivery icon="file" label="试验证据齐套" value={motors.filter((motor) => motorTestIssues(motor, tests, snapshot.documents).length === 0).length} total={motors.length} /><Delivery icon="shield" label="整机检验证据齐套" value={motors.filter((motor) => targetInspectionEvidence(motor, "motor", inspections, snapshot.documents).issues.length === 0).length} total={motors.length} /><Delivery icon="check" label="零部件检验证据齐套" value={parts.filter((part) => targetInspectionEvidence(part, "part", inspections, snapshot.documents).issues.length === 0).length} total={parts.length} /></div></article></div><aside className="npd2-overview-side"><article className="npd2-panel"><div className="npd2-panel-title"><div><h2>项目团队</h2><p>{members.length} 人协同</p></div>{steward && canMaintain && <button className="npd2-icon-button" aria-label="添加或维护项目成员" title="添加或维护项目成员" onClick={() => onDialog({ kind: "member" })}><Icon name="plus" /></button>}</div><p className="npd2-stage-note">当前负责人：{project.ownerName}{snapshot.users.find((user) => user.id === project.ownerId)?.active === false ? "（账号已停用，请办理交接）" : ""}</p>{canManageProjectLifecycle(currentUser, project) && <button className="npd2-button npd2-button-soft" onClick={() => onDialog({ kind: "owner_transfer" })}><Icon name="users" />负责人交接</button>}<div className="npd2-member-list">{members.map((member) => <div key={member.id}><span>{member.userName.slice(-2)}</span><div><b>{member.userName}{snapshot.users.find((user) => user.id === member.userId)?.active === false ? "（账号已停用）" : ""}<em>{member.roleLabel}</em></b><p>{member.responsibility}</p></div></div>)}</div></article><article className="npd2-panel"><div className="npd2-panel-title"><div><h2>最近动态</h2><p>全操作时间戳</p></div></div><div className="npd2-timeline">{activities.slice(0, 12).map((activity) => <div key={activity.id}><i /><div><b>{activity.action}<span>{activity.actorName}</span></b><p>{activity.detail}</p><small>{formatDateTime(activity.createdAt)}</small></div></div>)}</div></article></aside></div>;
}

function Delivery({ icon, label, value, total }: { icon: string; label: string; value: number; total: number }) {
  const progress = total ? Math.round(value / total * 100) : 0;
  return <div className="npd2-delivery"><span><Icon name={icon} /></span><div><b>{label}</b><small>{value} / {total} 项齐套</small><ProgressBar value={progress} /></div><strong>{progress}%</strong></div>;
}

function SheetContent({ project, snapshot, currentUser, sheetCode, editable, onDialog }: { project: NpdProject; snapshot: NpdWorkspaceSnapshot; currentUser: NpdUser; sheetCode: SheetCode; editable: boolean; onDialog: (dialog: DialogState) => void }) {
  const definition = sheetByCode[sheetCode];
  const sheet = snapshot.sheets.find((item) => item.projectId === project.id && item.code === sheetCode)!;
  const motors = snapshot.motors.filter((item) => item.projectId === project.id);
  const parts = snapshot.parts.filter((item) => item.projectId === project.id);
  const docs = snapshot.documents.filter((item) => item.projectId === project.id && item.sheetCode === sheetCode);
  const revisions = snapshot.sheetRevisions.filter((item) => item.projectId === project.id && item.sheetCode === sheetCode);
  return <div className="npd2-sheet-page"><section className="npd2-sheet-hero"><div className="npd2-sheet-number" style={{ background: definition.color }}>{definition.index}</div><div><span className="npd2-eyebrow">阶段 Sheet · {sheet.ownerRoleLabel}负责</span><h2>{definition.title}</h2><p>{definition.subtitle}</p></div><div className="npd2-sheet-meta"><span><small>计划节点</small><b>{formatDate(sheet.plannedDate)}</b></span><span><small>版本</small><b>V{sheet.version}</b></span><span><small>最后维护</small><b>{sheet.updatedByName || "—"}</b></span><span><small>更新时间</small><b>{formatDateTime(sheet.updatedAt)}</b></span></div></section><StageAssignmentNotice snapshot={snapshot} projectId={project.id} sheetCode={sheetCode} /><StageRecordedNote note={sheet.note} blocked={sheet.status === "blocked"} />{sheetCode === "input_output" && <RequirementOutput motors={motors} editable={editable} onDialog={onDialog} />}{definition.formCodes.length > 0 && <ControlledForms project={project} snapshot={snapshot} formCodes={definition.formCodes} editable={editable} onDialog={onDialog} />}{sheetCode === "parts_plan" && <MotorProductionPanel motors={motors} canConfirm={editable && (currentUser.role === "admin" || currentUser.role === "production")} onConfirm={(motorId) => onDialog({ kind: "confirm_motor", motorId })} />}{sheetCode === "parts_plan" && <PartsTable parts={parts} currentUser={currentUser} editable={editable} onDialog={onDialog} />}{sheetCode === "verification" && <Reports project={project} snapshot={snapshot} editable={editable} onDialog={onDialog} />}{sheetCode === "quality_inspection" && <Inspections project={project} snapshot={snapshot} editable={editable} onDialog={onDialog} />}<RevisionHistory key={sheetCode} revisions={revisions} /><Documents documents={docs} /></div>;
}

function StageRecordedNote({ note, blocked }: { note: string; blocked: boolean }) {
  if (!note) return null;
  return <div className={`npd2-stage-note ${blocked ? "blocked" : ""}`}><Icon name={blocked ? "alert" : "file"} /><div><b>阶段备注（记录时内容）</b><p>{note}</p></div></div>;
}

function RequirementOutput({ motors, editable, onDialog }: { motors: ProjectMotor[]; editable: boolean; onDialog: (dialog: DialogState) => void }) {
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>规格级设计输出要求</h2><p>检验要求和试验要求作为后续质量、验证 Sheet 的唯一受控来源</p></div></div><div className="npd2-output-grid">{motors.map((motor) => <div key={motor.id}><header><span><Icon name="motor" /></span><b>{motor.model}</b>{editable && <button aria-label={`变更设计输出：${motor.model}`} title={`变更设计输出：${motor.model}`} onClick={() => onDialog({ kind: "motor", motor })}><Icon name="edit" /></button>}</header><section><small><Icon name="shield" />检验要求</small><p>{motor.inspectionRequirement || "尚未配置"}</p></section><section><small><Icon name="file" />试验要求</small><p>{motor.testRequirement || "尚未配置"}</p></section></div>)}</div></article>;
}

function ControlledForms({ project, snapshot, formCodes, editable, onDialog }: { project: NpdProject; snapshot: NpdWorkspaceSnapshot; formCodes: string[]; editable: boolean; onDialog: (dialog: DialogState) => void }) {
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>受控程序表单</h2><p>提交用于留痕，不代表阶段已放行；失败结论及未闭环条件须处理后复核。</p></div></div>
    <div className="npd2-form-cards">{formCodes.map((code) => {
      const form = formDefinitions.find((item) => item.code === code)!;
      const record = snapshot.formRecords.find((item) => item.projectId === project.id && item.formCode === code);
      const submitted = record?.status === "submitted";
      const issues = submitted ? formReleaseIssues(form, record.payload) : [];
      const payload = record?.payload;
      const filled = form.fields.filter((field) => {
        const value = payload?.[field.key];
        return value !== undefined && value !== null && (typeof value !== "string" || Boolean(value.trim())) && (!Array.isArray(value) || value.length);
      }).length;
      return <div key={code} className="npd2-form-card">
        <div className={`npd2-form-code ${submitted && !issues.length ? "done" : ""}`}>{form.shortCode}</div>
        <div><div className="npd2-form-card-title"><b>{form.name}</b><StatusBadge value={issues.length ? "blocked" : record?.status || "not_started"} label={issues.length ? "已提交 · 待处理" : submitted ? "已提交" : record ? "草稿" : "未填写"} /></div>
          <p>{form.purpose}</p>{issues.length > 0 && <div className="npd2-stage-note blocked" role="status">放行待处理：{issues.join("；")}</div>}
          <div className="npd2-form-card-meta"><span>字段 {filled}/{form.fields.length}</span><span>版本 V{record?.version || 0}</span><span>最后维护 {record?.updatedByName || "—"}</span><span>{formatDateTime(record?.updatedAt)}</span></div>
        </div>
        <button className="npd2-button npd2-button-ghost" onClick={() => onDialog({ kind: "view_form", formCode: code })}><Icon name="file" />查看内容</button>
        {editable && <button className="npd2-button npd2-button-soft" onClick={() => onDialog({ kind: "form", formCode: code })}><Icon name="edit" />{record ? "继续维护" : "填写表单"}</button>}
      </div>;
    })}</div></article>;
}

function PartsTable({ parts, currentUser, editable, onDialog }: { parts: NpdWorkspaceSnapshot["parts"]; currentUser: NpdUser; editable: boolean; onDialog: (dialog: DialogState) => void }) {
  const canConfirm = editable && (currentUser.role === "admin" || currentUser.role === "production");
  const canChange = editable && currentUser.role !== "production";
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>零部件明细与计划节点</h2><p>设计/工艺/采购维护输出版次，生产确认时间节点，检验要求始终关联当前版次</p></div>{editable && <button className="npd2-button npd2-button-primary" onClick={() => onDialog({ kind: "part" })}><Icon name="plus" />新增零部件</button>}</div>{parts.length ? <div className="npd2-table-wrap"><table className="npd2-table"><thead><tr><th>零部件</th><th>关联规格</th><th>规格 / 材质</th><th>设计输出与检验要求</th><th>计划节点</th><th>生产状态</th><th>操作</th></tr></thead><tbody>{parts.map((part) => <tr key={part.id}><td><b>{part.partNo}</b><span>{part.name} · R{part.designRevision} · {part.sourceType} · {part.quantity}件</span></td><td>{part.motorModel || "系列通用"}</td><td>{part.specification || "—"}<span>{part.material || "—"}</span></td><td><small className="npd2-ref">{part.designOutputRef}</small><span>{part.inspectionRequirement}</span></td><td>{part.plannedDate}<span>{part.actualDate ? `实际 ${part.actualDate}` : "未完工"}</span></td><td><StatusBadge value={part.status} label={partStatusLabel(part.status)} />{part.confirmedByName && <span>{part.confirmedByName} · {formatDateTime(part.confirmedAt)}</span>}</td><td><div className="npd2-row-actions">{canChange && <button className="npd2-icon-button" title="变更零部件" aria-label={`变更零部件：${part.partNo} ${part.name}`} onClick={() => onDialog({ kind: "part", partId: part.id })}><Icon name="edit" /></button>}{canConfirm && <button className="npd2-icon-button" title="生产确认" aria-label={`生产确认：${part.partNo} ${part.name}`} onClick={() => onDialog({ kind: "confirm_part", partId: part.id })}><Icon name="check" /></button>}</div></td></tr>)}</tbody></table></div> : <EmptyState title="尚无零部件节点" detail="新增零部件后，生产人员可确认进行、完成或受阻状态。" action={editable && <button className="npd2-button npd2-button-primary" onClick={() => onDialog({ kind: "part" })}>新增第一条记录</button>} />}</article>;
}

function RevisionHistory({ revisions }: { revisions: NpdWorkspaceSnapshot["sheetRevisions"] }) {
  const [selected, setSelected] = useState<NpdWorkspaceSnapshot["sheetRevisions"][number] | null>(null);
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>版本与修改记录</h2><p>每次状态、表单、规格、零部件、报告、检验和附件变更均形成不可覆盖记录</p></div><span className="npd2-count">{revisions.length} 个版本</span></div>{revisions.length ? <div className="npd2-revision-list">{revisions.map((revision) => <div key={revision.id}><strong>V{revision.version}</strong><div><b>{revision.action}</b><p>{revision.summary}</p><small>变更原因：{revision.reason || "日常维护"}</small></div><span><StatusBadge value={revision.status} label={sheetStatusLabels[revision.status]} /><button className="npd2-button npd2-button-soft" onClick={() => setSelected(revision)}>查看版本内容</button><small>{revision.actorName} · {formatDateTime(revision.createdAt)}</small></span></div>)}</div> : <EmptyState icon="clock" title="暂无版本记录" detail="下一次维护会自动生成版本记录。" />}{selected && <RevisionDetail revision={selected} revisions={revisions} onClose={() => setSelected(null)} />}</article>;
}

function Reports({ project, snapshot, editable, onDialog }: { project: NpdProject; snapshot: NpdWorkspaceSnapshot; editable: boolean; onDialog: (dialog: DialogState) => void }) {
  const reports = snapshot.testReports.filter((item) => item.projectId === project.id);
  const stageStatus = snapshot.sheets.find((item) => item.projectId === project.id && item.code === "verification")?.status;
  const motors = snapshot.motors.filter((item) => item.projectId === project.id);
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>规格级试验报告</h2><p>放行只认当前设计版次的最新报告；旧版和返工前报告永久保留</p></div>{editable && <button className="npd2-button npd2-button-primary" onClick={() => onDialog({ kind: "test" })}><Icon name="plus" />提交试验报告</button>}</div><div className="npd2-report-grid">{motors.map((motor) => {
    const items = reports.filter((item) => item.motorId === motor.id);
    const issues = motorTestIssues(motor, items, snapshot.documents);
    const evidenceStatus = evidenceStageStatus(stageStatus, issues.length === 0);
    return <div className="npd2-report-group" key={motor.id}><header><span><Icon name="motor" /></span><div><b>{motor.model} · 当前 R{motor.designRevision}</b><small>{items.length} 份历史/当前报告</small></div><StatusBadge value={evidenceStatus.value} label={evidenceStatus.label} /></header>{issues.length > 0 && <p className="npd2-stage-note blocked">{issues.join("；")}</p>}{items.map((item) => <div className="npd2-report-item" key={item.id}><div><b>{item.reportNo} · {item.title}</b><span>关联 R{item.requirementRevision}{item.requirementRevision === motor.designRevision ? " · 当前版" : " · 历史版"} · {item.reportType} · {item.testDate} · {item.submittedByName}</span><p>试验依据：{item.requirementRef || "未记录"}</p><p>试验结论：{item.conclusion || "未填写"}</p><small>提交时间：{formatDateTime(item.createdAt)}{!item.documentId ? " · 缺少附件，不计入齐套进度" : ""}</small></div><StatusBadge value={item.result === "不合格" ? "blocked" : "completed"} label={item.result} />{item.documentId && <a href={`/api/files/${item.documentId}`} aria-label={`下载试验附件：${motor.model} · ${item.reportNo}`} title={item.fileName || "下载试验附件"}><Icon name="file" /></a>}</div>)}</div>;
  })}</div></article>;
}

function Inspections({ project, snapshot, editable, onDialog }: { project: NpdProject; snapshot: NpdWorkspaceSnapshot; editable: boolean; onDialog: (dialog: DialogState) => void }) {
  const inspections = snapshot.inspections.filter((item) => item.projectId === project.id);
  const targets = [
    ...snapshot.motors.filter((item) => item.projectId === project.id).map((item) => ({ item, type: "motor" as const, label: item.model })),
    ...snapshot.parts.filter((item) => item.projectId === project.id).map((item) => ({ item, type: "part" as const, label: `${item.partNo} ${item.name}` })),
  ].map((target) => ({ ...target, ...targetInspectionEvidence(target.item, target.type, inspections, snapshot.documents) }));
  const completed = targets.filter((target) => !target.issues.length).length;
  const stageStatus = snapshot.sheets.find((item) => item.projectId === project.id && item.code === "quality_inspection")?.status;
  const evidenceStatus = evidenceStageStatus(stageStatus, targets.length > 0 && completed === targets.length);
  const currentRevision = (item: NpdWorkspaceSnapshot["inspections"][number]) => item.itemType === "motor"
    ? snapshot.motors.find((motor) => motor.id === item.motorId)?.designRevision
    : snapshot.parts.find((part) => part.id === item.partItemId)?.designRevision;
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>质量检验记录</h2><p>检验依据自动引用设计输出，旧版记录保留但不参与当前版次放行</p></div>{editable && <button className="npd2-button npd2-button-primary" onClick={() => onDialog({ kind: "inspection" })}><Icon name="plus" />提交检验记录</button>}</div><div className={`npd2-stage-note ${evidenceStatus.value === "blocked" ? "blocked" : ""}`} role="status"><div><b>当前设计版次证据齐套 {completed}/{targets.length} · {evidenceStatus.label}</b>{targets.filter((target) => target.issues.length).map((target) => <p key={`${target.type}:${target.item.id}`}>{target.label}：{target.issues.join("；")}</p>)}</div></div>{inspections.length ? <div className="npd2-inspection-list">{inspections.map((item) => { const active = currentRevision(item) === item.requirementRevision; const latest = targets.some((target) => target.record?.id === item.id); return <div key={item.id}><span className={`npd2-inspection-icon ${item.itemType}`}><Icon name={item.itemType === "motor" ? "motor" : "folder"} /></span><div className="npd2-inspection-main"><div><b>{item.itemName}</b><small>{item.itemType === "motor" ? "整机检验" : "零部件检验"} · 关联 R{item.requirementRevision} · {active ? latest ? "当前版最新提交" : "当前版 · 已被后续记录替代" : "历史版"} · {item.inspectionDate}</small></div><p><em>设计要求</em>{item.inspectionRequirement}</p><span>检验结论：{item.conclusion || "未填写"}</span>{!item.documentId && <p>缺少附件，不计入齐套进度。</p>}</div><div className="npd2-inspection-result"><StatusBadge value={item.result === "不合格" ? "blocked" : "completed"} label={item.result} /><small>{item.inspectorName}<br />{formatDateTime(item.createdAt)}</small></div>{item.documentId && <a className="npd2-icon-button" href={`/api/files/${item.documentId}`} aria-label={`下载检验附件：${item.itemName} · R${item.requirementRevision} · ${item.inspectionDate}`} title="下载检验附件"><Icon name="file" /></a>}</div>; })}</div> : <EmptyState icon="shield" title="尚无质量检验记录" detail="质量人员可选择整机或零部件，系统会从设计输出自动引用检验要求。" />}</article>;
}

function Documents({ documents }: { documents: NpdWorkspaceSnapshot["documents"] }) {
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>附件与归档索引</h2><p>本 Sheet 的报告、图纸、图片及其他支撑文件</p></div><span className="npd2-count">{documents.length} 个附件</span></div>{documents.length ? <div className="npd2-doc-list">{documents.map((document) => <a key={document.id} href={`/api/files/${document.id}`}><span><Icon name="file" /></span><div><b>{document.fileName}</b><small>{documentKindLabel(document.kind)} · {formatSize(document.size)} · {document.uploadedByName}</small></div><em>V{document.version}</em><small>{formatDateTime(document.createdAt)}</small><Icon name="export" /></a>)}</div> : <EmptyState icon="file" title="暂无附件" detail="有编辑权限的人员可使用底部“上传附件”加入本阶段归档。" />}</article>;
}

function formatSize(size: number) { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
