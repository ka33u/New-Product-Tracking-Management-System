import type { RoleKey } from "./domain";

export type Permission =
  | "project:view"
  | "project:create"
  | "project:update"
  | "project:close"
  | "project:tailor"
  | "order:view"
  | "order:manage"
  | "order:link"
  | "form:edit"
  | "form:submit"
  | "approval:decide"
  | "change:create"
  | "change:approve"
  | "issue:manage"
  | "file:upload"
  | "report:view"
  | "user:manage"
  | "audit:view";

export const roleLabels: Record<RoleKey, string> = {
  system_admin: "系统管理员",
  management: "经营管理层",
  technical_director: "技术总监",
  project_manager: "项目负责人",
  designer: "设计工程师",
  process: "工艺工程师",
  quality: "质量工程师",
  manufacturing: "制造/装配",
  procurement: "采购",
  sales: "销售",
  finance: "财务",
  viewer: "只读访客",
};

const allPermissions: Permission[] = [
  "project:view",
  "project:create",
  "project:update",
  "project:close",
  "project:tailor",
  "order:view",
  "order:manage",
  "order:link",
  "form:edit",
  "form:submit",
  "approval:decide",
  "change:create",
  "change:approve",
  "issue:manage",
  "file:upload",
  "report:view",
  "user:manage",
  "audit:view",
];

export const permissionsByRole: Record<RoleKey, Permission[]> = {
  system_admin: allPermissions,
  management: [
    "project:view",
    "project:create",
    "project:close",
    "project:tailor",
    "order:view",
    "order:manage",
    "order:link",
    "approval:decide",
    "change:approve",
    "report:view",
    "audit:view",
  ],
  technical_director: [
    "project:view",
    "project:create",
    "project:update",
    "project:close",
    "project:tailor",
    "order:view",
    "order:link",
    "form:edit",
    "form:submit",
    "approval:decide",
    "change:create",
    "change:approve",
    "issue:manage",
    "file:upload",
    "report:view",
    "audit:view",
  ],
  project_manager: [
    "project:view",
    "project:create",
    "project:update",
    "order:view",
    "order:link",
    "form:edit",
    "form:submit",
    "change:create",
    "issue:manage",
    "file:upload",
    "report:view",
  ],
  designer: [
    "project:view",
    "project:update",
    "order:view",
    "form:edit",
    "form:submit",
    "change:create",
    "issue:manage",
    "file:upload",
  ],
  process: [
    "project:view",
    "project:update",
    "order:view",
    "form:edit",
    "form:submit",
    "change:create",
    "issue:manage",
    "file:upload",
  ],
  quality: [
    "project:view",
    "project:update",
    "order:view",
    "form:edit",
    "form:submit",
    "approval:decide",
    "change:create",
    "issue:manage",
    "file:upload",
    "report:view",
  ],
  manufacturing: [
    "project:view",
    "project:update",
    "form:edit",
    "form:submit",
    "change:create",
    "issue:manage",
    "file:upload",
  ],
  procurement: [
    "project:view",
    "project:update",
    "order:view",
    "form:edit",
    "change:create",
    "issue:manage",
    "file:upload",
  ],
  sales: [
    "project:view",
    "project:create",
    "project:update",
    "order:view",
    "order:manage",
    "order:link",
    "form:edit",
    "form:submit",
    "change:create",
    "issue:manage",
    "file:upload",
    "report:view",
  ],
  finance: [
    "project:view",
    "order:view",
    "form:edit",
    "form:submit",
    "report:view",
  ],
  viewer: ["project:view", "order:view", "report:view"],
};

export function hasPermission(role: RoleKey, permission: Permission) {
  return permissionsByRole[role].includes(permission);
}
