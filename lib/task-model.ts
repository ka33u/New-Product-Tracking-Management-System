import type { NpdProject, NpdUser, NpdWorkspaceSnapshot, ProjectSheet } from "./npd-v2";
import { canEditSheet, canSeeProject } from "./access-v2";
import { businessDate, validBusinessDate } from "./dashboard-model";
import { stageAssignment } from "./stage-assignment";

export interface StageTask {
  id: string;
  project: NpdProject;
  sheet: ProjectSheet;
  dueLabel: string;
  dueValid: boolean;
  overdue: boolean;
  danger: boolean;
  assignees: string;
}

export function buildTaskModel(snapshot: Pick<NpdWorkspaceSnapshot, "users" | "projects" | "sheets" | "members">, requestedUser: NpdUser, asOf = businessDate()) {
  if (!validBusinessDate(asOf)) throw new Error("任务统计日期无效。");
  const result = { pending: [] as StageTask[], paused: [] as StageTask[], completedByMe: 0, atRisk: 0, invalidDates: 0, asOf };
  const user = snapshot.users.find((item) => item.id === requestedUser.id);
  if (!user?.active) return result;
  const projects = new Map(snapshot.projects.filter((project) => canSeeProject(user, project, snapshot.members)).map((project) => [project.id, project]));
  for (const sheet of snapshot.sheets) {
    const project = projects.get(sheet.projectId);
    if (!project) continue;
    if (sheet.status === "completed") {
      if (sheet.updatedBy === user.id) result.completedByMe++;
      continue;
    }
    if (!["active", "draft", "paused"].includes(project.status)) continue;
    // For paused projects only, classify work the user could maintain after
    // resumption. This projection grants no permission and changes no state.
    if (!canEditSheet(user, project.status === "paused" ? { ...project, status: "active" } : project, sheet.code)) continue;
    const dueValid = validBusinessDate(sheet.plannedDate);
    const overdue = dueValid && sheet.plannedDate < asOf;
    const task = { id: sheet.id, project, sheet, dueValid, overdue,
      dueLabel: dueValid ? sheet.plannedDate : sheet.plannedDate ? "日期待核对" : "未设置",
      danger: overdue || sheet.status === "blocked", assignees: stageAssignment(snapshot, project.id, sheet.code).label };
    (project.status === "paused" ? result.paused : result.pending).push(task);
  }
  const compare = (a: StageTask, b: StageTask) => Number(b.dueValid) - Number(a.dueValid)
    || (a.dueValid && b.dueValid ? a.sheet.plannedDate.localeCompare(b.sheet.plannedDate) : 0)
    || a.project.code.localeCompare(b.project.code) || a.sheet.sortOrder - b.sheet.sortOrder || a.id.localeCompare(b.id);
  result.pending.sort(compare); result.paused.sort(compare);
  result.atRisk = result.pending.filter((task) => task.danger).length;
  result.invalidDates = result.pending.filter((task) => !task.dueValid).length;
  return result;
}

export type TaskModel = ReturnType<typeof buildTaskModel>;
