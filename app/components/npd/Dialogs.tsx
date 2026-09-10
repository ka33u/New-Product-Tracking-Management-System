"use client";

import { useRef, useState, type FormEvent } from "react";
import { formDefinitions } from "../../../lib/forms";
import type {
  NpdFormRecord,
  NpdProject,
  NpdSalesOrder,
  NpdUser,
  NpdWorkspaceSnapshot,
  PartItem,
  ProjectMotor,
  ProjectSheet,
  SheetCode,
} from "../../../lib/npd-v2";
import { partStatusLabel, roleLabels, sheetStatusLabels } from "../../../lib/npd-v2";
import { sheetByCode } from "../../../lib/sheets-v2";
import { addDays, Field, getFormObject, Icon, Modal, ModalCancelButton, SubmitBar, today } from "./ui";

export type RunAction = (kind: string, payload: unknown) => Promise<unknown>;
export type UploadFile = (file: File, options: { projectId: string; sheetCode: SheetCode; motorId?: string | null; kind: string }) => Promise<string>;

export function CreateProjectDialog({ snapshot, onClose, onAction }: { snapshot: NpdWorkspaceSnapshot; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [baseOrderVersions] = useState(() => Object.fromEntries(snapshot.orders.map((order) => [order.id, order.version])));
  // These keys only identify draft rows in this dialog; the server assigns real IDs.
  // A local counter also works over LAN HTTP, where crypto.randomUUID is absent.
  const nextMotorId = useRef(1);
  const availableOrders = snapshot.orders.filter((order) => order.customerId === customerId && !order.projectId);
  const blankMotor = (id: string) => ({ id, model: "", ratedPower: "", voltage: "380V", frequency: "50Hz", poles: "", speed: "", frameSize: "", mounting: "B3", terminalMode: "接线盒顶部出线", protectionGrade: "IP55", insulationClass: "F级", coolingMethod: "IC411", quantity: 1, inspectionRequirement: "", testRequirement: "", plannedDate: addDays(90) });
  const [motors, setMotors] = useState(() => [blankMotor("draft-motor-0")]);
  const active = snapshot.users.filter((user) => user.active);
  const byRole = (role: NpdUser["role"]) => active.filter((user) => user.role === role);
  const owners = active.filter((user) => ["admin", "sales", "design"].includes(user.role));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setSaveError("");
    try {
      const raw = getFormObject(event.currentTarget);
      if (orderIds.some((id) => !availableOrders.some((order) => order.id === id))) {
        throw new Error("所选订单已被其他项目关联，请重新选择；其他填写内容仍保留。");
      }
      await onAction("create_project", {
        name: raw.name, seriesName: raw.seriesName, category: raw.category,
        source: raw.source, customerId: raw.customerId, ownerId: raw.ownerId,
        processId: raw.processId, procurementId: raw.procurementId,
        productionId: raw.productionId, testerId: raw.testerId, qualityId: raw.qualityId,
        plannedStart: raw.plannedStart, plannedEnd: raw.plannedEnd, priority: raw.priority,
        riskLevel: raw.riskLevel, description: raw.description, orderIds, orderVersions: baseOrderVersions,
        motors: motors.map((motor) => Object.fromEntries(
          Object.entries(motor).filter(([key]) => key !== "id"),
        )),
      });
      onClose();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "创建失败，填写内容仍保留。"); } finally { setBusy(false); }
  };
  const updateMotor = (id: string, key: string, value: string | number) => setMotors((old) => old.map((motor) => motor.id === id ? { ...motor, [key]: value } : motor));
  return <Modal protectChanges busy={busy} title="创建新品开发项目" eyebrow="发起人即当前登录人员" onClose={onClose} wide><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-section"><h3>项目基本信息</h3><div className="npd2-form-grid"><Field label="项目名称" required><input name="name" required placeholder="例如：YBX5 高效隔爆电机开发" /></Field><Field label="系列名称" required><input name="seriesName" required placeholder="同系列多规格归集名称" /></Field><Field label="产品类别" required><select name="category" defaultValue="异步电动机"><option>异步电动机</option><option>永磁同步电机</option><option>防爆电机</option><option>专用电机</option><option>其他</option></select></Field><Field label="项目来源" required><select name="source" defaultValue="客户订单"><option>客户订单</option><option>市场开发</option><option>行业要求</option><option>企业研发</option></select></Field><Field label="关联客户" required><select name="customerId" required value={customerId} onChange={(event) => { setCustomerId(event.target.value); setOrderIds([]); }}><option value="" disabled>请选择客户</option>{snapshot.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></Field><Field label="项目负责人" required hint="负责人负责项目全流程数据维护"><select name="ownerId" required defaultValue=""><option value="" disabled>请选择销售/设计负责人</option>{owners.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.roleLabel}</option>)}</select></Field><Field label="计划开始" required><input name="plannedStart" type="date" required defaultValue={today()} /></Field><Field label="计划完成" required><input name="plannedEnd" type="date" required defaultValue={addDays(120)} /></Field><Field label="优先级"><select name="priority" defaultValue="normal"><option value="urgent">紧急</option><option value="high">高</option><option value="normal">正常</option><option value="low">低</option></select></Field><Field label="风险等级"><select name="riskLevel" defaultValue="medium"><option value="low">低</option><option value="medium">中</option><option value="high">高</option><option value="critical">严重</option></select></Field><Field label="项目说明" full><textarea name="description" rows={3} placeholder="业务目标、关键边界、订单或技术协议背景" /></Field></div></div><div className="npd2-form-section"><h3>关联销售订单 · 已选 {orderIds.length} 张</h3><p>可多选同一客户的未关联订单；没有订单时也可先立项。</p>{!customerId ? <p>请先选择关联客户。</p> : availableOrders.length === 0 ? <p>该客户暂无未关联订单，可先在销售订单中录入。</p> : <div className="npd2-check-grid">{availableOrders.map((order) => <label key={order.id}><input type="checkbox" checked={orderIds.includes(order.id)} disabled={busy} onChange={(event) => setOrderIds((old) => event.target.checked ? [...old, order.id] : old.filter((id) => id !== order.id))} /><span><b>{order.orderNo}</b><br />{order.productSummary} · {order.quantity} 台 · 交期 {order.deliveryDate}</span></label>)}</div>}{orderIds.some((id) => !availableOrders.some((order) => order.id === id)) && <p className="npd2-stage-note blocked" role="alert">部分已选订单已不可关联。<button type="button" data-npd-edit onClick={() => setOrderIds((old) => old.filter((id) => availableOrders.some((order) => order.id === id)))}>移除失效选择</button></p>}</div><div className="npd2-form-section"><h3>跨部门责任人</h3><div className="npd2-form-grid"><RoleSelect name="processId" label="工艺负责人" users={byRole("process")} /><RoleSelect name="procurementId" label="采购负责人" users={byRole("procurement")} /><RoleSelect name="productionId" label="生产负责人" users={byRole("production")} /><RoleSelect name="testerId" label="试验负责人" users={byRole("tester")} /><RoleSelect name="qualityId" label="质量负责人" users={byRole("quality")} /></div></div><div className="npd2-form-section"><div className="npd2-section-row"><div><h3>电机具体规格</h3><p>一个项目可同时管理同系列的多个型号规格。</p></div><button type="button" className="npd2-button npd2-button-soft" data-npd-edit onClick={() => { const motor = blankMotor(`draft-motor-${nextMotorId.current++}`); setMotors((old) => [...old, motor]); }}><Icon name="plus" />增加规格</button></div>{motors.map((motor, index) => <div className="npd2-motor-editor" key={motor.id}><div className="npd2-motor-editor-head"><b>规格 {index + 1}</b>{motors.length > 1 && <button type="button" data-npd-edit onClick={() => setMotors((old) => old.filter((item) => item.id !== motor.id))}>移除</button>}</div><div className="npd2-form-grid npd2-form-grid-4"><Field label="型号规格" required><input required value={motor.model} onChange={(e) => updateMotor(motor.id, "model", e.target.value)} /></Field><Field label="额定功率"><input value={motor.ratedPower} onChange={(e) => updateMotor(motor.id, "ratedPower", e.target.value)} placeholder="如 55kW" /></Field><Field label="电压"><input value={motor.voltage} onChange={(e) => updateMotor(motor.id, "voltage", e.target.value)} /></Field><Field label="频率"><input value={motor.frequency} onChange={(e) => updateMotor(motor.id, "frequency", e.target.value)} /></Field><Field label="极数"><input value={motor.poles} onChange={(e) => updateMotor(motor.id, "poles", e.target.value)} /></Field><Field label="转速"><input value={motor.speed} onChange={(e) => updateMotor(motor.id, "speed", e.target.value)} /></Field><Field label="机座号"><input value={motor.frameSize} onChange={(e) => updateMotor(motor.id, "frameSize", e.target.value)} /></Field><Field label="安装方式"><input value={motor.mounting} onChange={(e) => updateMotor(motor.id, "mounting", e.target.value)} /></Field><Field label="出线形式"><input value={motor.terminalMode} onChange={(e) => updateMotor(motor.id, "terminalMode", e.target.value)} /></Field><Field label="防护等级"><input value={motor.protectionGrade} onChange={(e) => updateMotor(motor.id, "protectionGrade", e.target.value)} /></Field><Field label="绝缘等级"><input value={motor.insulationClass} onChange={(e) => updateMotor(motor.id, "insulationClass", e.target.value)} /></Field><Field label="冷却方式"><input value={motor.coolingMethod} onChange={(e) => updateMotor(motor.id, "coolingMethod", e.target.value)} /></Field><Field label="数量"><input type="number" min="1" value={motor.quantity} onChange={(e) => updateMotor(motor.id, "quantity", Number(e.target.value))} /></Field><Field label="计划完成" required><input type="date" required value={motor.plannedDate} onChange={(e) => updateMotor(motor.id, "plannedDate", e.target.value)} /></Field><Field label="检验要求" required full><textarea required rows={2} value={motor.inspectionRequirement} onChange={(e) => updateMotor(motor.id, "inspectionRequirement", e.target.value)} placeholder="设计输出的整机检验项目、指标与判定依据" /></Field><Field label="试验要求" required full><textarea required rows={2} value={motor.testRequirement} onChange={(e) => updateMotor(motor.id, "testRequirement", e.target.value)} placeholder="设计输出的型式试验项目、工况和判定要求" /></Field></div></div>)}</div><SubmitBar busy={busy} onCancel={onClose} primary="创建并进入项目" /></form></Modal>;
}

function RoleSelect({ name, label, users }: { name: string; label: string; users: NpdUser[] }) {
  return <Field label={label} required><select name={name} required defaultValue=""><option value="" disabled>请选择{label}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}</select></Field>;
}

export function MotorDialog({ project, motor, onClose, onAction }: { project: NpdProject; motor?: ProjectMotor; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [baseRevision] = useState(motor?.designRevision || 0);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setSaveError("");
    try {
      const raw = getFormObject(event.currentTarget);
      const value = { ...raw, quantity: Number(raw.quantity || 1), expectedRevision: baseRevision };
      if (motor) await onAction("update_motor", { motorId: motor.id, motor: value });
      else await onAction("add_motor", { projectId: project.id, motor: value });
      onClose();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); }
  };
  return <Modal protectChanges busy={busy} title={motor ? `变更 ${motor.model} · 当前 R${motor.designRevision}` : "增加电机规格"} eyebrow={project.code} onClose={onClose} wide><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-grid">
    <Field label="型号规格" required><input name="model" required defaultValue={motor?.model} /></Field>
    <Field label="额定功率"><input name="ratedPower" defaultValue={motor?.ratedPower} /></Field>
    <Field label="电压"><input name="voltage" defaultValue={motor?.voltage || "380V"} /></Field>
    <Field label="频率"><input name="frequency" defaultValue={motor?.frequency || "50Hz"} /></Field>
    <Field label="极数"><input name="poles" defaultValue={motor?.poles} /></Field>
    <Field label="转速"><input name="speed" defaultValue={motor?.speed} /></Field>
    <Field label="机座号"><input name="frameSize" defaultValue={motor?.frameSize} /></Field>
    <Field label="安装方式"><input name="mounting" defaultValue={motor?.mounting || "B3"} /></Field>
    <Field label="出线形式"><input name="terminalMode" defaultValue={motor?.terminalMode || "接线盒顶部出线"} /></Field>
    <Field label="防护等级"><input name="protectionGrade" defaultValue={motor?.protectionGrade || "IP55"} /></Field>
    <Field label="绝缘等级"><input name="insulationClass" defaultValue={motor?.insulationClass || "F级"} /></Field>
    <Field label="冷却方式"><input name="coolingMethod" defaultValue={motor?.coolingMethod || "IC411"} /></Field>
    <Field label="数量"><input name="quantity" type="number" min="1" defaultValue={motor?.quantity || 1} /></Field>
    <Field label="计划完成" required><input name="plannedDate" type="date" required defaultValue={motor?.plannedDate || project.plannedEnd} /></Field>
    <Field label="检验要求" required full hint="后续质量检验记录自动引用当前设计版次。"><textarea name="inspectionRequirement" required rows={4} defaultValue={motor?.inspectionRequirement} /></Field>
    <Field label="试验要求" required full hint="后续试验报告必须与当前设计版次一致。"><textarea name="testRequirement" required rows={4} defaultValue={motor?.testRequirement} /></Field>
    {motor && <Field label="变更原因" required full hint="修改后升级设计版次，并自动将已完成的下游阶段转为待复核。"><textarea name="changeReason" required rows={3} placeholder="说明客户变更、设计优化、试制反馈或纠正原因" /></Field>}
  </div><SubmitBar busy={busy} onCancel={onClose} primary={motor ? "保存为新设计版次" : "增加规格"} /></form></Modal>;
}

export function ControlledFormDialog({ project, formCode, record, onClose, onAction }: { project: NpdProject; formCode: string; record?: NpdFormRecord; onClose: () => void; onAction: RunAction }) {
  const definition = formDefinitions.find((form) => form.code === formCode)!;
  const [payload, setPayload] = useState<Record<string, unknown>>(record?.payload || {});
  const [changeReason, setChangeReason] = useState("");
  const [baseVersion] = useState(record?.version || 0);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (submit: boolean) => { if (busy) return; setBusy(true); setSaveError(""); try { await onAction("save_form", { projectId: project.id, formCode, formPayload: payload, submit, changeReason, expectedVersion: baseVersion }); onClose(); } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留在此窗口。"); } finally { setBusy(false); } };
  return <Modal protectChanges busy={busy} title={definition.name} eyebrow={`${project.code} · ${definition.shortCode}`} onClose={onClose} wide>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-note"><Icon name="shield" /><div><b>受控表单 · {definition.stage}</b><p>{definition.purpose} 必填项完整后方可正式提交，所有保存和提交操作均记录时间戳。</p></div></div><div className="npd2-form-grid">{definition.fields.map((field) => <Field key={field.key} label={field.label} required={field.required} hint={field.hint} full={field.span === "full"}>{field.type === "textarea" ? <textarea rows={4} value={String(payload[field.key] ?? "")} onChange={(event) => setPayload((old) => ({ ...old, [field.key]: event.target.value }))} /> : field.type === "select" ? <select value={String(payload[field.key] ?? "")} onChange={(event) => setPayload((old) => ({ ...old, [field.key]: event.target.value }))}><option value="">请选择</option>{field.options?.map((option) => <option key={option}>{option}</option>)}</select> : field.type === "multiselect" ? <div className="npd2-check-grid">{field.options?.map((option) => { const checked = Array.isArray(payload[field.key]) && (payload[field.key] as unknown[]).includes(option); return <label key={option}><input type="checkbox" checked={checked} onChange={(event) => setPayload((old) => { const current = Array.isArray(old[field.key]) ? old[field.key] as string[] : []; return { ...old, [field.key]: event.target.checked ? [...current, option] : current.filter((item) => item !== option) }; })} /><span>{option}</span></label>; })}</div> : field.type === "checkbox" ? <label className="npd2-switch-row"><input type="checkbox" checked={Boolean(payload[field.key])} onChange={(event) => setPayload((old) => ({ ...old, [field.key]: event.target.checked }))} /><span>确认</span></label> : <input type={field.type} value={String(payload[field.key] ?? "")} onChange={(event) => setPayload((old) => ({ ...old, [field.key]: field.type === "number" ? Number(event.target.value) : event.target.value }))} />}</Field>)}</div>{record && <div className="npd2-form-grid"><Field label="本次变更原因" required full hint="已存在版本再次保存时必填，用于审计和下游复核。"><textarea rows={3} value={changeReason} onChange={(event) => setChangeReason(event.target.value)} placeholder="说明修改依据、影响范围及需要重新确认的内容" /></Field></div>}<div className="npd2-submit-bar"><ModalCancelButton onCancel={onClose} busy={busy} /><button className="npd2-button npd2-button-soft" disabled={busy || Boolean(record && !changeReason.trim())} onClick={() => save(false)}>保存草稿</button><button className="npd2-button npd2-button-primary" disabled={busy || Boolean(record && !changeReason.trim())} onClick={() => save(true)}>{busy ? "提交中…" : "提交受控版本"}</button></div></Modal>;
}

export function SheetDialog({ project, sheet, onClose, onAction }: { project: NpdProject; sheet: ProjectSheet; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [baseVersion] = useState(sheet.version);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; setBusy(true); setSaveError(""); try { const raw = getFormObject(event.currentTarget); await onAction("update_sheet", { projectId: project.id, sheetCode: sheet.code, status: raw.status, progress: Number(raw.progress), plannedDate: raw.plannedDate, note: raw.note, changeReason: raw.changeReason, expectedVersion: baseVersion }); onClose(); } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留在此窗口。"); } finally { setBusy(false); } };
  return <Modal protectChanges busy={busy} title={`更新 ${sheetByCode[sheet.code].shortTitle}`} eyebrow="阶段状态与放行" onClose={onClose}><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-gate-note"><Icon name="shield" /><p>阶段标记“已完成”时，系统会校验前置阶段、受控表单、零部件节点、试验报告和质量检验的齐套性。上游变更会保留原结论并触发下游复核。</p></div><div className="npd2-form-grid npd2-form-grid-one"><Field label="阶段状态" required><select name="status" defaultValue={sheet.status}>{Object.entries(sheetStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="完成度" required><input name="progress" type="number" min="0" max="100" defaultValue={sheet.progress} /></Field><Field label="计划完成日期" required><input name="plannedDate" type="date" required defaultValue={sheet.plannedDate} /></Field><Field label="说明/受阻原因"><textarea name="note" rows={4} defaultValue={sheet.note} /></Field><Field label="本次调整原因" required><textarea name="changeReason" required rows={3} placeholder="说明状态、进度、计划节点或放行结论的调整依据" /></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="更新并生成新版本" /></form></Modal>;
}

export function PartDialog({ project, motors, part, onClose, onAction }: { project: NpdProject; motors: ProjectMotor[]; part?: PartItem; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [baseRevision] = useState(part?.designRevision || 0);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; setBusy(true); setSaveError(""); try { const raw = getFormObject(event.currentTarget); const value = { ...raw, motorId: raw.motorId || null, quantity: Number(raw.quantity || 1), expectedRevision: baseRevision }; if (part) await onAction("update_part", { partId: part.id, part: value }); else await onAction("add_part", { ...value, projectId: project.id }); onClose(); } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); } };
  return <Modal protectChanges busy={busy} title={part ? `变更 ${part.partNo} · 当前 R${part.designRevision}` : "新增零部件与计划节点"} eyebrow={`${project.code} · Sheet 5`} onClose={onClose} wide><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-grid"><Field label="关联电机规格"><select name="motorId" defaultValue={part?.motorId || ""}><option value="">系列通用件</option>{motors.map((motor) => <option key={motor.id} value={motor.id}>{motor.model}</option>)}</select></Field><Field label="零部件编号" required><input name="partNo" required defaultValue={part?.partNo} /></Field><Field label="零部件名称" required><input name="name" required defaultValue={part?.name} /></Field><Field label="规格"><input name="specification" defaultValue={part?.specification} /></Field><Field label="材质"><input name="material" defaultValue={part?.material} /></Field><Field label="数量"><input name="quantity" type="number" min="1" defaultValue={part?.quantity || 1} /></Field><Field label="来源"><select name="sourceType" defaultValue={part?.sourceType || "自制"}><option>自制</option><option>外协</option><option>外购</option><option>借用</option></select></Field><Field label="计划完成" required><input name="plannedDate" type="date" required defaultValue={part?.plannedDate || project.plannedEnd} /></Field><Field label="设计输出引用" required full hint="例如：图纸 HD-YBX5-001 / BOM A1 第 12 项"><input name="designOutputRef" required defaultValue={part?.designOutputRef} /></Field><Field label="检验要求" required full><textarea name="inspectionRequirement" required rows={3} defaultValue={part?.inspectionRequirement} placeholder="尺寸、材质、性能、抽检比例及合格判据" /></Field><Field label="试验要求" full><textarea name="testRequirement" rows={3} defaultValue={part?.testRequirement} placeholder="如该零部件需专项试验，请填写项目及判定要求" /></Field>{part && <Field label="变更原因" required full hint="保存后升级零部件设计版次，原生产确认和检验记录保留为历史记录。"><textarea name="changeReason" required rows={3} /></Field>}</div><SubmitBar busy={busy} onCancel={onClose} primary={part ? "保存为新设计版次" : "加入节点计划"} /></form></Modal>;
}

export function ConfirmPartDialog({ part, sheetVersion, onClose, onAction }: { part: PartItem; sheetVersion: number; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [baseRevision] = useState(part.designRevision);
  const [baseSheetVersion] = useState(sheetVersion);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; setBusy(true); setSaveError(""); try { const raw = getFormObject(event.currentTarget); await onAction("confirm_part", { partId: part.id, status: raw.status, note: raw.note, expectedRevision: baseRevision, expectedSheetVersion: baseSheetVersion }); onClose(); } catch (error) { setSaveError(error instanceof Error ? error.message : "确认失败，填写内容仍保留。"); } finally { setBusy(false); } };
  return <Modal protectChanges busy={busy} title={`确认 ${part.partNo} ${part.name}`} eyebrow="生产节点确认" onClose={onClose}><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-summary-strip"><span>计划节点<b>{part.plannedDate}</b></span><span>当前状态<b>{partStatusLabel(part.status)}</b></span></div><div className="npd2-form-grid npd2-form-grid-one"><Field label="确认状态" required><select name="status" defaultValue={part.status === "planned" ? "in_progress" : part.status}><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="blocked">受阻</option></select></Field><Field label="确认说明"><textarea name="note" rows={4} placeholder="填写完工情况或受阻原因" /></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="提交生产确认" /></form></Modal>;
}

type UploadedEvidenceReceipt = { fileName: string; targetLabel: string };

function UploadedEvidenceNotice({ receipt }: { receipt: UploadedEvidenceReceipt | null }) {
  if (!receipt) return null;
  return <div className="npd2-form-note npd2-upload-receipt" role="status"><Icon name="file" /><div><b>附件已保留</b><p>“{receipt.fileName}” · 上传时选择：{receipt.targetLabel}</p><p>附件上传与记录提交是两步操作，请依据提交结果核对记录。同一窗口继续提交相同文件和对象时会复用此附件；关闭窗口不会删除已上传文件。</p></div></div>;
}

export function TestReportDialog({ project, motors: currentMotors, onClose, onAction, onUpload }: { project: NpdProject; motors: ProjectMotor[]; onClose: () => void; onAction: RunAction; onUpload: UploadFile }) {
  const [motors] = useState(currentMotors);
  const [saveError, setSaveError] = useState("");
  const uploaded = useRef<{ file: File; target: string; id: string } | null>(null);
  const submitting = useRef(false);
  const [uploadReceipt, setUploadReceipt] = useState<UploadedEvidenceReceipt | null>(null);
  const [busy, setBusy] = useState(false); const [motorId, setMotorId] = useState(motors[0]?.id || "");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setSaveError("");
    try {
      const form = event.currentTarget; const raw = getFormObject(form);
      const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
      if (file && (uploaded.current?.file !== file || uploaded.current?.target !== motorId)) {
        const id = await onUpload(file, { projectId: project.id, sheetCode: "verification", motorId, kind: "test_report" });
        uploaded.current = { file, target: motorId, id };
        const target = motors.find(item => item.id === motorId);
        setUploadReceipt({ fileName: file.name, targetLabel: `${target?.model || motorId} · R${target?.designRevision ?? "待核对"}` });
      }
      const documentId = file ? uploaded.current?.id || null : null;
      await onAction("create_test_report", { projectId: project.id, motorId, expectedRevision: motors.find((item) => item.id === motorId)?.designRevision, reportNo: raw.reportNo, reportType: raw.reportType, title: raw.title, requirementRef: raw.requirementRef, testDate: raw.testDate, result: raw.result, conclusion: raw.conclusion, documentId });
      onClose();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "提交失败，填写内容与本次已上传附件仍保留。"); }
    finally { submitting.current = false; setBusy(false); }
  };
  const motor = motors.find((item) => item.id === motorId);
  return <Modal protectChanges busy={busy} title="提交型式/验证试验报告" eyebrow={`${project.code} · Sheet 6`} onClose={onClose} wide><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<UploadedEvidenceNotice receipt={uploadReceipt} /><div className="npd2-form-grid"><Field label="电机规格" required><select value={motorId} onChange={(event) => setMotorId(event.target.value)} required>{motors.map((item) => <option key={item.id} value={item.id}>{item.model}</option>)}</select></Field><Field label="报告编号" required><input name="reportNo" required /></Field><Field label="报告类型" required><select name="reportType" defaultValue="型式试验"><option>型式试验</option><option>性能试验</option><option>专项验证</option><option>第三方检测</option></select></Field><Field label="报告名称" required><input name="title" required /></Field><Field label="试验日期" required><input name="testDate" type="date" defaultValue={today()} required /></Field><Field label="试验结果" required><select name="result" defaultValue="合格"><option>合格</option><option>有条件合格</option><option>不合格</option></select></Field><Field label="关联试验要求" required full hint="自动引用当前设计输出；变更要求请先维护设计输出。"><textarea name="requirementRef" rows={3} readOnly value={motor?.testRequirement || ""} /></Field><Field label="试验结论" full hint="有条件合格需填写限制条件与处置依据。"><textarea name="conclusion" rows={3} /></Field><Field label="试验报告附件" full hint="单文件不超过 25MB；缺附件的记录不计入齐套进度，也不能放行阶段。"><input name="file" type="file" /></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="提交试验报告" /></form></Modal>;
}

export function InspectionDialog({ project, motors: currentMotors, parts: currentParts, onClose, onAction, onUpload }: { project: NpdProject; motors: ProjectMotor[]; parts: PartItem[]; onClose: () => void; onAction: RunAction; onUpload: UploadFile }) {
  const [motors] = useState(currentMotors); const [parts] = useState(currentParts);
  const [saveError, setSaveError] = useState("");
  const uploaded = useRef<{ file: File; target: string; id: string } | null>(null);
  const submitting = useRef(false);
  const [uploadReceipt, setUploadReceipt] = useState<UploadedEvidenceReceipt | null>(null);
  const [busy, setBusy] = useState(false); const [itemType, setItemType] = useState<"motor" | "part">("motor"); const [targetId, setTargetId] = useState(motors[0]?.id || "");
  const targets = itemType === "motor" ? motors : parts.filter((part) => Boolean(part.inspectionRequirement));
  const requirement = itemType === "motor" ? motors.find((item) => item.id === targetId)?.inspectionRequirement : parts.find((item) => item.id === targetId)?.inspectionRequirement;
  const switchType = (value: "motor" | "part") => { setItemType(value); const values = value === "motor" ? motors : parts.filter((part) => Boolean(part.inspectionRequirement)); setTargetId(values[0]?.id || ""); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (submitting.current) return; submitting.current = true; setBusy(true); setSaveError("");
    try {
      const form = event.currentTarget; const raw = getFormObject(form);
      const file = (form.elements.namedItem("file") as HTMLInputElement).files?.[0];
      const motorId = itemType === "motor" ? targetId : null;
      const target = `${itemType}:${targetId}`;
      if (file && (uploaded.current?.file !== file || uploaded.current?.target !== target)) {
        const id = await onUpload(file, { projectId: project.id, sheetCode: "quality_inspection", motorId, kind: "inspection_record" });
        uploaded.current = { file, target, id };
        const item = targets.find(value => value.id === targetId);
        const label = item && ("model" in item ? item.model : `${item.partNo} ${item.name}`);
        setUploadReceipt({ fileName: file.name, targetLabel: `${itemType === "motor" ? "整机" : "零部件"} ${label || targetId} · R${item?.designRevision ?? "待核对"}` });
      }
      const documentId = file ? uploaded.current?.id || null : null;
      await onAction("create_inspection", { projectId: project.id, itemType, motorId, expectedRevision: targets.find((item) => item.id === targetId)?.designRevision, partItemId: itemType === "part" ? targetId : null, inspectionDate: raw.inspectionDate, result: raw.result, conclusion: raw.conclusion, documentId });
      onClose();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "提交失败，填写内容与本次已上传附件仍保留。"); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Modal protectChanges busy={busy} title="提交质量检验记录" eyebrow={`${project.code} · Sheet 7`} onClose={onClose} wide><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<UploadedEvidenceNotice receipt={uploadReceipt} /><div className="npd2-segment"><button type="button" className={itemType === "motor" ? "active" : ""} data-npd-edit onClick={() => switchType("motor")}>整机检验</button><button type="button" className={itemType === "part" ? "active" : ""} data-npd-edit onClick={() => switchType("part")}>零部件检验</button></div><div className="npd2-form-grid"><Field label="检验对象" required><select value={targetId} onChange={(event) => setTargetId(event.target.value)} required><option value="" disabled>请选择</option>{targets.map((item) => <option key={item.id} value={item.id}>{"model" in item ? item.model : `${item.partNo} ${item.name}`}</option>)}</select></Field><Field label="检验日期" required><input name="inspectionDate" type="date" defaultValue={today()} required /></Field><Field label="检验结果" required><select name="result" defaultValue="合格"><option>合格</option><option>让步接收</option><option>不合格</option></select></Field><Field label="检验报告附件" hint="检验记录、测量报告或图片"><input name="file" type="file" /></Field><Field label="设计输出中的检验要求" full><div className="npd2-derived"><Icon name="link" /><span>{requirement || "该对象尚未配置检验要求"}</span></div></Field><Field label="检验结论" full><textarea name="conclusion" rows={4} /></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="提交检验记录" /></form></Modal>;
}

export function MemberDialog({ project, snapshot, onClose, onAction }: { project: NpdProject; snapshot: NpdWorkspaceSnapshot; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [baseMembers] = useState(() => snapshot.members.filter((member) => member.projectId === project.id));
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; setBusy(true); setSaveError(""); try { const raw = getFormObject(event.currentTarget); const member = baseMembers.find((item) => item.userId === raw.userId); await onAction("assign_member", { projectId: project.id, userId: raw.userId, responsibility: raw.responsibility, expected: member ? { id: member.id, version: member.version } : null }); onClose(); } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); } };
  return <Modal protectChanges busy={busy} title="分配项目参与人员" eyebrow={project.code} onClose={onClose}><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-grid npd2-form-grid-one"><Field label="人员" required><select name="userId" defaultValue="" required><option value="" disabled>请选择人员</option>{snapshot.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name} · {roleLabels[user.role]} · {user.department}</option>)}</select></Field><Field label="项目职责" required><textarea name="responsibility" required rows={4} placeholder="填写该人员在本项目中的具体职责和交付物" /></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="保存人员分配" /></form></Modal>;
}

export function ProjectStatusDialog({ project, onClose, onAction }: { project: NpdProject; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [baseStatus] = useState(project.status);
  const [baseLifecycleVersion] = useState(project.lifecycleVersion);
  const [saveError, setSaveError] = useState(""); const [status, setStatus] = useState(project.status === "paused" ? "active" : "paused");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; setBusy(true); setSaveError(""); try { const raw = getFormObject(event.currentTarget); await onAction("set_project_status", { projectId: project.id, status, reason: raw.reason, expectedStatus: baseStatus, expectedLifecycleVersion: baseLifecycleVersion }); onClose(); } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); } };
  return <Modal protectChanges busy={busy} title="变更项目运行状态" eyebrow={project.code} onClose={onClose}><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<p className="npd2-stage-note">本次操作基于状态版本 V{baseLifecycleVersion}。若期间发生暂停、恢复或结项，请重新打开窗口核对后再提交。</p><div className="npd2-form-grid npd2-form-grid-one"><Field label="目标状态" required><select value={status} onChange={(event) => setStatus(event.target.value as "active" | "paused" | "cancelled")}><option value="active">恢复进行</option><option value="paused">暂停</option><option value="cancelled">终止</option></select></Field><Field label="变更原因" required><textarea name="reason" rows={4} required /></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="确认变更" /></form></Modal>;
}

export function CreateUserDialog({ onClose, onAction, localAuth = false }: { onClose: () => void; onAction: RunAction; localAuth?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setSaveError("");
    try {
      const raw = getFormObject(event.currentTarget);
      await onAction("create_user", {
        name: raw.name,
        email: raw.email,
        department: raw.department,
        role: raw.role,
        active: raw.active === "on",
        password: raw.password || undefined,
      });
      onClose();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); }
  };
  return <Modal protectChanges busy={busy} title="新建登录账户" eyebrow="管理员操作" onClose={onClose}><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-note"><Icon name="shield" /><div><b>邮箱即登录身份</b><p>{localAuth ? "请设置初始密码，并通过安全方式告知本人。密码仅保存加盐哈希，不能查看原密码。" : "本站使用企业 ChatGPT 身份登录。"}</p></div></div><div className="npd2-form-grid"><Field label="人员姓名" required><input name="name" required autoComplete="name" /></Field><Field label="登录邮箱" required><input name="email" type="email" required autoComplete="email" placeholder="name@company.com" /></Field><Field label="所属部门" required><input name="department" required placeholder="例如：技术部·设计科" /></Field><Field label="登录类型" required><select name="role" defaultValue="design">{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="本地初始密码" required={localAuth} hint={`${localAuth ? "必填" : "可选"}；至少 8 位，需同时包含字母和数字。`}><input name="password" type="password" required={localAuth} minLength={8} maxLength={128} autoComplete="new-password" /></Field><Field label="账号状态"><label className="npd2-switch-row"><input name="active" type="checkbox" defaultChecked /><span>创建后立即启用</span></label></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="创建账户" /></form></Modal>;
}

export function UserDialog({ user, onClose, onAction }: { user: NpdUser; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [base] = useState(user);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (busy) return; setBusy(true); setSaveError(""); try { const raw = getFormObject(event.currentTarget); await onAction("update_user", { userId: user.id, expected: base, name: raw.name, email: raw.email, role: raw.role, department: raw.department, active: raw.active === "on", password: raw.password || undefined }); onClose(); } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); } };
  return <Modal protectChanges busy={busy} title={`维护 ${user.name} 账户`} eyebrow="管理员操作" onClose={onClose}><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-user-card"><span>{user.avatar}</span><div><b>{user.name}</b><small>{user.email} · {user.roleLabel}</small></div></div><div className="npd2-form-grid"><Field label="人员姓名" required><input name="name" required defaultValue={user.name} autoComplete="name" /></Field><Field label="登录邮箱" required hint="修改他人邮箱后，新邮箱将成为登录身份。"><input name="email" type="email" required defaultValue={user.email} autoComplete="email" /></Field><Field label="所属部门" required><input name="department" required defaultValue={user.department} /></Field><Field label="登录类型" required><select name="role" defaultValue={user.role}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="重置本地密码" hint="留空则不修改；至少 8 位且包含字母和数字。"><input name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" /></Field><Field label="账号状态"><label className="npd2-switch-row"><input name="active" type="checkbox" defaultChecked={user.active} /><span>启用此账号</span></label></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="保存账户" /></form></Modal>;
}

export function SalesOrderDialog({ snapshot, onClose, onAction }: { snapshot: NpdWorkspaceSnapshot; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setSaveError("");
    try {
      const raw = getFormObject(event.currentTarget);
      await onAction("create_order", {
        orderNo: raw.orderNo, customerId: raw.customerId,
        productSummary: raw.productSummary, quantity: Number(raw.quantity || 1),
        amount: Number(raw.amount || 0), currency: raw.currency,
        orderDate: raw.orderDate, deliveryDate: raw.deliveryDate,
      });
      onClose();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); }
  };
  return <Modal protectChanges busy={busy} title="录入销售订单" eyebrow="订单台账与新品项目关联" onClose={onClose} wide><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-grid"><Field label="订单号" required><input name="orderNo" required placeholder="如 SO-2026-1201" /></Field><Field label="客户" required><select name="customerId" required defaultValue=""><option value="" disabled>请选择客户</option>{snapshot.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.code} · {customer.name}</option>)}</select></Field><Field label="产品/规格概要" required full><textarea name="productSummary" required rows={3} placeholder="订单产品系列、型号规格及特殊要求" /></Field><Field label="数量" required><input name="quantity" type="number" min="1" defaultValue="1" required /></Field><Field label="订单金额"><input name="amount" type="number" min="0" step="0.01" defaultValue="0" /></Field><Field label="币种"><select name="currency" defaultValue="CNY"><option>CNY</option><option>USD</option><option>EUR</option></select></Field><Field label="订单日期" required><input name="orderDate" type="date" defaultValue={today()} required /></Field><Field label="计划交付日期" required><input name="deliveryDate" type="date" defaultValue={addDays(120)} required /></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="录入订单" /></form></Modal>;
}

export function LinkOrderDialog({ order, snapshot, onClose, onAction }: { order: NpdSalesOrder; snapshot: NpdWorkspaceSnapshot; onClose: () => void; onAction: RunAction }) {
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setSaveError("");
    try {
      const raw = getFormObject(event.currentTarget);
      await onAction("link_order", { orderId: order.id, projectId: raw.projectId || null, expectedProjectId: baseProjectId, expectedVersion: baseVersion });
      onClose();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "保存失败，填写内容仍保留。"); } finally { setBusy(false); }
  };
  const [baseProjectId] = useState(order.projectId);
  const [baseVersion] = useState(order.version);
  const projects = snapshot.projects.filter((project) => project.customerId === order.customerId &&
    (project.id === order.projectId || !["cancelled", "paused", "completed"].includes(project.status)));
  return <Modal protectChanges busy={busy} title={`关联订单 ${order.orderNo}`} eyebrow={order.customerName} onClose={onClose}><form onSubmit={submit}>{saveError && <p className="npd2-stage-note blocked" role="alert">{saveError}</p>}<div className="npd2-form-note"><Icon name="link" /><div><b>客户一致性校验</b><p>只能关联同一客户的新品项目；一个项目可以关联多个销售订单。</p></div></div><div className="npd2-form-grid npd2-form-grid-one"><Field label="新品开发项目"><select name="projectId" defaultValue={order.projectId || ""}><option value="">不关联项目</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></Field></div><SubmitBar busy={busy} onCancel={onClose} primary="保存订单关联" /></form></Modal>;
}
