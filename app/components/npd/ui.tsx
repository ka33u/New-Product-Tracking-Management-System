"use client";

import type { ReactNode } from "react";

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>,
    task: <><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    export: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 18v2h14v-2"/></>,
    arrow: <path d="m9 18 6-6-6-6"/>,
    back: <path d="m15 18-6-6 6-6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    alert: <><path d="M12 3 2.8 19h18.4Z"/><path d="M12 9v4m0 3h.01"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    edit: <><path d="m4 16-.8 4 4-.8L18.5 7.9a2.1 2.1 0 0 0-3-3Z"/><path d="m13.8 6.2 4 4"/></>,
    file: <><path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></>,
    upload: <><path d="M12 16V4m0 0L8 8m4-4 4 4"/><path d="M4 16v4h16v-4"/></>,
    motor: <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M19 10h3v4h-3M2 9h3v6H2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.36.38.68.67.92.3.24.67.38 1.05.4H21v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/></>,
    shield: <><path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6Z"/><path d="m9 12 2 2 4-4"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  };
  return <svg className="npd2-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.file}</svg>;
}

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="npd2-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`npd2-modal ${wide ? "npd2-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><div>{eyebrow && <span className="npd2-eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="npd2-icon-button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button></header>
      <div className="npd2-modal-body">{children}</div>
    </section>
  </div>;
}

export function StatusBadge({ value, label }: { value: string; label: string }) {
  return <span className={`npd2-badge npd2-badge-${value}`}>{label}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  return <div className="npd2-progress" aria-label={`进度 ${value}%`}><span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function EmptyState({ icon = "folder", title, detail, action }: { icon?: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="npd2-empty"><span><Icon name={icon} size={24} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function Field({ label, required, hint, children, full = false }: { label: string; required?: boolean; hint?: string; children: ReactNode; full?: boolean }) {
  return <label className={`npd2-field ${full ? "npd2-field-full" : ""}`}><span>{label}{required && <b> *</b>}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function SubmitBar({ busy, onCancel, primary = "保存", secondary, onSecondary }: { busy: boolean; onCancel: () => void; primary?: string; secondary?: string; onSecondary?: () => void }) {
  return <div className="npd2-submit-bar"><button type="button" className="npd2-button npd2-button-ghost" onClick={onCancel}>取消</button>{secondary && <button type="button" className="npd2-button npd2-button-soft" disabled={busy} onClick={onSecondary}>{secondary}</button>}<button type="submit" className="npd2-button npd2-button-primary" disabled={busy}>{busy ? "处理中…" : primary}</button></div>;
}

export const formatDate = (value: string | null | undefined) => value ? value.slice(0, 10) : "—";
export const formatDateTime = (value: string | null | undefined) => value ? value.replace("T", " ").replace(/\.\d+Z$/, "").slice(0, 16) : "—";
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };

export function getFormObject(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}
