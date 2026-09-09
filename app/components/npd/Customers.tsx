"use client";

import { useState, type FormEvent } from "react";
import type { NpdCustomer } from "../../../lib/npd-v2";
import type { RunAction } from "./Dialogs";
import { EmptyState, Field, getFormObject, Icon, Modal, SubmitBar } from "./ui";

export function Customers({ customers, query, onEdit, onCreate }: {
  customers: NpdCustomer[]; query: string; onEdit: (customer: NpdCustomer) => void; onCreate: () => void;
}) {
  const matches = customers.filter((customer) => [customer.code, customer.name, customer.industry, customer.contact, customer.phone]
    .some((value) => value.toLowerCase().includes(query.trim().toLowerCase())));
  return <div className="npd2-page">
    <div className="npd2-page-heading"><div><span className="npd2-eyebrow">销售基础资料</span><h1>客户资料</h1>
      <p>客户资料用于新建订单和新品项目。修改会同步到当前关联项目，历史操作记录保留。</p></div>
      <button className="npd2-button npd2-button-primary" onClick={onCreate}><Icon name="plus" />新增客户</button></div>
    <article className="npd2-panel npd2-project-table-wrap">{matches.length ? <table className="npd2-table">
      <thead><tr><th>客户编号</th><th>客户名称</th><th>行业</th><th>联系人</th><th>联系电话</th><th>操作</th></tr></thead>
      <tbody>{matches.map((customer) => <tr key={customer.id}><td>{customer.code}</td><td><b>{customer.name}</b></td>
        <td>{customer.industry}</td><td>{customer.contact || "—"}</td><td>{customer.phone || "—"}</td>
        <td><button className="npd2-button npd2-button-soft" onClick={() => onEdit(customer)}><Icon name="edit" />维护资料</button></td></tr>)}</tbody>
    </table> : <EmptyState title="没有匹配的客户" detail="调整搜索条件，或新增客户后再录入订单和项目。" />}</article>
  </div>;
}

export function CustomerDialog({ customer, onClose, onAction }: { customer?: NpdCustomer; onClose: () => void; onAction: RunAction }) {
  const [base] = useState(customer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const values = getFormObject(event.currentTarget);
      await onAction("save_customer", { ...values, id: base?.id, expected: base });
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "保存失败，填写内容仍保留。"); }
    finally { setBusy(false); }
  }
  return <Modal protectChanges busy={busy} title={base ? `维护 ${base.name}` : "新增客户"} eyebrow="销售 / 管理员" onClose={onClose}>
    <form onSubmit={submit}>{error && <p className="npd2-stage-note blocked" role="alert">{error}</p>}
      <div className="npd2-form-grid">
        <Field label="客户编号" required hint="唯一编号，字母自动转为大写。"><input name="code" required maxLength={64} defaultValue={base?.code} placeholder="例如：HD-KH-001" /></Field>
        <Field label="客户名称" required><input name="name" required maxLength={200} defaultValue={base?.name} /></Field>
        <Field label="所属行业" required><input name="industry" required maxLength={200} defaultValue={base?.industry} /></Field>
        <Field label="联系人"><input name="contact" maxLength={200} defaultValue={base?.contact} autoComplete="name" /></Field>
        <Field label="联系电话"><input name="phone" type="tel" maxLength={200} defaultValue={base?.phone} autoComplete="tel" /></Field>
        {base && <Field label="变更原因" required full><textarea name="reason" required rows={3} maxLength={2000} placeholder="说明客户更名、联系人交接等修改依据" /></Field>}
      </div><SubmitBar busy={busy} onCancel={onClose} primary={base ? "保存客户资料" : "新增客户"} />
    </form>
  </Modal>;
}
