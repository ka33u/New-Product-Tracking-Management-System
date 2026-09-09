import type { NpdWorkspaceSnapshot, SheetCode } from "./npd-v2";
import { roleLabels } from "./npd-v2";
import { sheetByCode } from "./sheets-v2";

// Current staffing only: never use this to rewrite historical report authors.
// Display does not grant permissions; the server still authorizes every write.
export function stageAssignment(snapshot: Pick<NpdWorkspaceSnapshot, "users" | "members" | "sheets">, projectId: string, code: SheetCode) {
  const role = snapshot.sheets.find((sheet) => sheet.projectId === projectId && sheet.code === code)?.ownerRole ?? sheetByCode[code].ownerRole;
  const roleLabel = roleLabels[role];
  const users = new Map(snapshot.users.map((user) => [user.id, user]));
  const seen = new Set<string>();
  const people: { id: string; label: string; active: boolean }[] = [];
  for (const member of snapshot.members) {
    if (member.projectId !== projectId || seen.has(member.userId)) continue;
    seen.add(member.userId);
    const user = users.get(member.userId);
    if ((user?.role ?? member.role) !== role) continue;
    people.push({ id: member.userId, active: user?.active === true,
      label: user ? user.name + (user.active ? "" : "（账号已停用）") : member.userName + "（账户待核对）" });
  }
  const activeCount = people.filter((person) => person.active).length;
  const names = people.map((person) => person.label).join("、");
  return { people, activeCount, needsAssignment: activeCount === 0, roleLabel,
    label: activeCount ? names : [names, `${roleLabel}待分配`].filter(Boolean).join("；") };
}
