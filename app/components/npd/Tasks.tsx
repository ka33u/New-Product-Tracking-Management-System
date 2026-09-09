import type { StageTask, TaskModel } from "../../../lib/task-model";
import { sheetStatusLabels } from "../../../lib/npd-v2";
import { sheetByCode } from "../../../lib/sheets-v2";
import { EmptyState, Icon, StatusBadge } from "./ui";

function TaskRows({ tasks, onOpen, paused = false }: { tasks: StageTask[]; onOpen: (id: string) => void; paused?: boolean }) {
  return <div className="npd2-task-list">{tasks.map((task) => <button key={task.id} onClick={() => onOpen(task.project.id)}>
    <span className={`npd2-task-icon ${!paused && task.danger ? "danger" : ""}`}><Icon name={!paused && task.danger ? "alert" : "file"} /></span>
    <div><b>{task.project.name}</b><small>{task.project.code} · {paused ? "项目已暂停" : "阶段 Sheet"}</small></div>
    <div className="npd2-task-stage"><b>{sheetByCode[task.sheet.code].shortTitle}</b><span>{task.assignees}</span></div>
    <StatusBadge value={task.sheet.status} label={sheetStatusLabels[task.sheet.status]} />
    <div className={!paused && task.overdue ? "danger" : ""}><small>计划节点</small><b>{task.dueLabel}</b></div><Icon name="arrow" />
  </button>)}</div>;
}

export function Tasks({ model, onOpen }: { model: TaskModel; onOpen: (id: string) => void }) {
  return <div className="npd2-page">
    <div className="npd2-page-heading"><div><span className="npd2-eyebrow">个人工作台</span><h1>我的任务</h1>
      <p>列出有维护权限的未完成阶段，含后续计划；阶段放行仍需满足前置条件。按北京时间 {model.asOf} 判断逾期。</p></div></div>
    <div className="npd2-task-summary">
      <span><Icon name="task" /><div><b>{model.pending.length}</b><small>待处理阶段</small></div></span>
      <span><Icon name="alert" /><div><b>{model.atRisk}</b><small>待办中逾期或受阻</small></div></span>
      <span><Icon name="check" /><div><b>{model.completedByMe}</b><small>我维护的已完成阶段</small></div></span>
    </div>
    <p className="npd2-task-explanation">暂停项目不计待办；已完成、已终止项目请在项目列表查看。完成统计按阶段当前状态及最后维护人计算，不是历史完成次数。</p>
    {model.invalidDates > 0 && <p className="npd2-stage-note blocked" role="status">{model.invalidDates} 个待办阶段的计划日期缺失或无效，列在末尾且不判定逾期，请核对计划。</p>}
    <article className="npd2-panel"><div className="npd2-panel-title"><div><h2>待处理清单</h2><p>按计划日期从近到远排列</p></div></div>
      {model.pending.length ? <TaskRows tasks={model.pending} onOpen={onOpen} /> : <EmptyState icon="check" title="当前没有可处理的阶段任务" detail={model.paused.length ? "还有暂停项目的阶段，恢复项目后重新计入待办。" : "可能尚未分配任务，或相关阶段已完成、项目已关闭。"} />}
    </article>
    {model.paused.length > 0 && <details className="npd2-panel npd2-paused-tasks"><summary>暂停项目中的阶段 · {model.paused.length} 项（不计入待办）</summary>
      <p>可打开项目查看；由有权限的人员恢复项目后才能继续维护。暂停不会自动顺延计划日期。</p>
      <TaskRows tasks={model.paused} onOpen={onOpen} paused />
    </details>}
  </div>;
}
