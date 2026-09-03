import type { NpdProject, NpdRole, NpdUser, ProjectMember, SheetCode } from "./npd-v2";
import { sheetByCode } from "./sheets-v2";

export type NpdPermission =
  | "project:create"
  | "project:view_all"
  | "project:manage"
  | "motor:manage"
  | "member:manage"
  | "parts:edit"
  | "parts:confirm"
  | "test:submit"
  | "quality:submit"
  | "sheet:edit"
  | "sheet:complete"
  | "file:upload"
  | "user:manage"
  | "dashboard:configure"
  | "export:data";

const permissions: Record<NpdRole, NpdPermission[]> = {
  admin: [
    "project:create", "project:view_all", "project:manage", "motor:manage",
    "member:manage", "parts:edit", "parts:confirm", "test:submit",
    "quality:submit", "sheet:edit", "sheet:complete", "file:upload",
    "user:manage", "dashboard:configure", "export:data",
  ],
  sales: [
    "project:create", "project:manage", "motor:manage", "member:manage",
    "sheet:edit", "sheet:complete", "file:upload", "dashboard:configure",
    "export:data",
  ],
  design: [
    "project:create", "project:manage", "motor:manage", "member:manage",
    "parts:edit", "sheet:edit", "sheet:complete", "file:upload",
    "dashboard:configure", "export:data",
  ],
  process: [
    "parts:edit", "sheet:edit", "sheet:complete", "file:upload",
    "dashboard:configure", "export:data",
  ],
  procurement: [
    "parts:edit", "sheet:edit", "file:upload", "dashboard:configure",
    "export:data",
  ],
  production: [
    "parts:edit", "parts:confirm", "sheet:edit", "sheet:complete",
    "file:upload", "dashboard:configure", "export:data",
  ],
  tester: [
    "test:submit", "sheet:edit", "sheet:complete", "file:upload",
    "dashboard:configure", "export:data",
  ],
  quality: [
    "quality:submit", "sheet:edit", "sheet:complete", "file:upload",
    "dashboard:configure", "export:data",
  ],
};

export function hasNpdPermission(role: NpdRole, permission: NpdPermission) {
  return permissions[role].includes(permission);
}

export function canCreateProject(role: NpdRole) {
  return role === "admin" || role === "sales" || role === "design";
}

export function canSeeProject(
  user: NpdUser,
  project: Pick<NpdProject, "id" | "initiatorId" | "ownerId">,
  members: ProjectMember[],
) {
  return (
    user.role === "admin" ||
    project.initiatorId === user.id ||
    project.ownerId === user.id ||
    members.some(
      (member) => member.projectId === project.id && member.userId === user.id,
    )
  );
}

export function isProjectSteward(
  user: NpdUser,
  project: Pick<NpdProject, "initiatorId" | "ownerId">,
) {
  return (
    user.role === "admin" ||
    project.initiatorId === user.id ||
    project.ownerId === user.id
  );
}

export function canEditSheet(
  user: NpdUser,
  project: Pick<NpdProject, "initiatorId" | "ownerId" | "status">,
  sheetCode: SheetCode,
) {
  if (project.status === "completed" || project.status === "cancelled") {
    return user.role === "admin";
  }
  if (isProjectSteward(user, project)) return true;
  const sheet = sheetByCode[sheetCode];
  if (sheet.ownerRole === user.role) return true;
  if (
    user.role === "design" &&
    ["input_output", "development_plan", "design_review", "parts_plan", "identification", "change_archive"].includes(sheetCode)
  ) {
    return true;
  }
  if (
    user.role === "process" &&
    ["development_plan", "design_review", "parts_plan", "identification", "change_archive"].includes(sheetCode)
  ) {
    return true;
  }
  if (
    user.role === "procurement" &&
    ["parts_plan", "change_archive"].includes(sheetCode)
  ) {
    return true;
  }
  return user.role === "sales" && ["initiation", "customer_trial"].includes(sheetCode);
}

export function assignableOwner(user: NpdUser) {
  return user.active && ["admin", "sales", "design"].includes(user.role);
}
