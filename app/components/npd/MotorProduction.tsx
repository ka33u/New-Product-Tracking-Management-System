"use client";

import { useRef, useState, type FormEvent } from "react";
import type { ProjectMotor } from "../../../lib/npd-v2";
import { motorProductionLabel } from "../../../lib/npd-v2";
import type { RunAction } from "./Dialogs";
import { Field, formatDateTime, getFormObject, Modal, StatusBadge, SubmitBar, today } from "./ui";

export function MotorProductionPanel({ motors, canConfirm, onConfirm }: {
  motors: ProjectMotor[]; canConfirm: boolean; onConfirm: (id: string) => void;
}) {
  return <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>整机生产节点</h2>
    <p>每个规格由生产确认。整机及零部件全部确认后仍需阶段复核；设计改版后重新确认，旧记录保留。</p></div></div>
    {motors.length ? <div className="npd2-table-wrap"><table className="npd2-table"><thead><tr>
      <th>电机规格</th><th>计划 / 实际完工</th><th>生产状态</th><th>确认人 / 时间</th><th>确认说明</th><th>操作</th>
    </tr></thead><tbody>{motors.map((motor) => <tr key={motor.id}>
      <td><b>{motor.model}</b><span>R{motor.designRevision} · {motor.quantity} 台</span></td>
      <td>{motor.plannedDate}<span>实际：{motor.actualDate || "未完工"}</span></td>
      <td><StatusBadge value={motor.status} label={motorProductionLabel(motor)} /></td>
      <td>{motor.confirmedByName || "尚未确认"}<span>{formatDateTime(motor.confirmedAt)}</span></td>
      <td>{motor.productionNote || "—"}</td>
      <td>{canConfirm && <button className="npd2-button npd2-button-soft" aria-label={`确认整机节点：${motor.model}`} onClick={() => onConfirm(motor.id)}>确认整机节点</button>}</td>
    </tr>)}</tbody></table></div> : <p>尚未录入整机规格。</p>}
  </article>;
}

export function ConfirmMotorDialog({ motor, sheetVersion, onClose, onAction }: {
  motor: ProjectMotor; sheetVersion: number; onClose: () => void; onAction: RunAction;
}) {
  const [base] = useState({ revision: motor.designRevision, sheetVersion });
  const [status, setStatus] = useState(motor.status === "planned" ? "in_progress" : motor.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending.current) return;
    const raw = getFormObject(event.currentTarget);
    pending.current = true; setBusy(true); setError("");
    try {
      await onAction("confirm_motor", { motorId: motor.id, status, actualDate: raw.actualDate || "", note: raw.note,
        expectedRevision: base.revision, expectedSheetVersion: base.sheetVersion });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，填写内容仍保留。"); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Modal protectChanges busy={busy} title={`确认整机节点 · ${motor.model}`} eyebrow={`设计 R${base.revision} · Sheet 5 V${base.sheetVersion}`} onClose={onClose}>
    <form onSubmit={submit}>{error && <p className="npd2-stage-note blocked" role="alert">{error}</p>}
      <p>计划完成 {motor.plannedDate}。确认仅代表生产状态，不替代试验或质量合格结论。重新打开完工节点将撤回下游阶段放行，原记录保留。</p>
      <div className="npd2-form-grid">
        <Field label="生产状态" required><select name="status" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="in_progress">生产中</option><option value="completed">生产已完成</option><option value="blocked">生产受阻</option>
        </select></Field>
        <Field label="实际完工日期" required={status === "completed"} hint="生产中或受阻时不记完工日期。">
          <input name="actualDate" type="date" required={status === "completed"} disabled={status !== "completed"} max={today()} defaultValue={motor.actualDate || today()} />
        </Field>
        <Field label="确认说明 / 变更原因" required full><textarea name="note" rows={3} required placeholder="说明实际完成情况、受阻原因或重新打开节点的依据" /></Field>
      </div><SubmitBar busy={busy} onCancel={onClose} primary="保存生产确认" />
    </form>
  </Modal>;
}
