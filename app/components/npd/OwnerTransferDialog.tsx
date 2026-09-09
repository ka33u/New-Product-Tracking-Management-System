"use client";

import { useState, type FormEvent } from "react";
import { assignableOwner } from "../../../lib/access-v2";
import type { NpdProject, NpdWorkspaceSnapshot } from "../../../lib/npd-v2";
import type { RunAction } from "./Dialogs";
import { Field, Modal, SubmitBar } from "./ui";

export function OwnerTransferDialog({ project, snapshot, onAction, onClose }: {
  project: NpdProject; snapshot: NpdWorkspaceSnapshot; onAction: RunAction; onClose: () => void;
}) {
  const [base] = useState(() => ({ ...project }));
  const [members] = useState(() => snapshot.members.filter((member) => member.projectId === project.id));
  const [newOwnerId, setNewOwnerId] = useState("");
  const [newDuty, setNewDuty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const oldMember = members.find((member) => member.userId === base.ownerId);
  const oldDuty = oldMember?.responsibility || "";
  const eligible = snapshot.users.filter((user) => assignableOwner(user) && user.id !== base.ownerId);
  const close = () => { if (!busy) onClose(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(event.currentTarget);
      const expectedMembers = Object.fromEntries([base.ownerId, newOwnerId].map((userId) => {
        const member = members.find((item) => item.userId === userId);
        return [userId, member ? { id: member.id, version: member.version } : null];
      }));
      await onAction("transfer_project_owner", { projectId: base.id, newOwnerId,
        expectedOwnerId: base.ownerId, expectedOwnershipVersion: base.ownershipVersion,
        expectedLifecycleVersion: base.lifecycleVersion, expectedMembers,
        previousOwnerResponsibility: String(form.get("previousDuty") || ""), newOwnerResponsibility: newDuty,
        reason: String(form.get("reason") || "") });
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "交接未保存，填写内容仍保留。"); }
    finally { setBusy(false); }
  };
  return <Modal protectChanges busy={busy} title="项目负责人交接" eyebrow={base.code} onClose={close}>
    <form onSubmit={submit}>
      <p className="npd2-stage-note">当前负责人：{base.ownerName} · 交接版本 V{base.ownershipVersion}。发起人、项目状态、阶段版本和历史报告保持不变。原负责人保留项目成员身份；若其仍是发起人或管理员，仍保留相应管理权限。</p>
      {error && <p className="npd2-stage-note blocked" role="alert">{error}</p>}
      {!eligible.length && <p className="npd2-stage-note blocked" role="alert">没有可接任的启用账户，请先由管理员开通销售或设计账户。</p>}
      <div className="npd2-form-grid npd2-form-grid-one">
        <Field label="接任负责人" required>
          <select value={newOwnerId} required disabled={busy} onChange={(event) => {
            setNewOwnerId(event.target.value);
            const duty = members.find((member) => member.userId === event.target.value)?.responsibility;
            setNewDuty(`项目总负责人与全流程数据维护${duty ? `；原有职责：${duty}` : ""}`);
          }}><option value="" disabled>请选择接任人员</option>{eligible.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.roleLabel}</option>)}</select>
        </Field>
        <Field label="新负责人交接后的职责" required><textarea value={newDuty} onChange={(event) => setNewDuty(event.target.value)} rows={3} required maxLength={2000} disabled={busy} /></Field>
        <Field label="原负责人交接后的职责" required hint={oldDuty ? `交接前职责：${oldDuty}` : "原负责人尚无独立成员职责记录，交接时将建立。"}>
          <textarea name="previousDuty" rows={3} required maxLength={2000} disabled={busy}
            defaultValue={["项目总负责人", "项目总负责人与全流程数据维护"].includes(oldDuty) || !oldDuty ? "交接协作，按当前角色参与项目" : oldDuty} />
        </Field>
        <Field label="交接原因与未完成事项" required><textarea name="reason" rows={4} required maxLength={2000} disabled={busy} placeholder="说明交接原因、未完成交付物及接任人需要跟进的事项" /></Field>
      </div>
      <SubmitBar busy={busy} disabled={!newOwnerId || !eligible.some((user) => user.id === newOwnerId)} onCancel={close} primary="确认交接" />
    </form>
  </Modal>;
}
