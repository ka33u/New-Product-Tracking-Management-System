import type { NpdWorkspaceSnapshot, SheetCode } from "../../../lib/npd-v2";
import { stageAssignment } from "../../../lib/stage-assignment";

export function StageAssignmentNotice({ snapshot, projectId, sheetCode }: {
  snapshot: Pick<NpdWorkspaceSnapshot, "users" | "members" | "sheets">;
  projectId: string;
  sheetCode: SheetCode;
}) {
  const assignment = stageAssignment(snapshot, projectId, sheetCode);
  return <div className="npd2-stage-assignment" role="status">
    <span>节点责任人 · {assignment.roleLabel}</span>
    <strong>{assignment.label}</strong>
    {assignment.needsAssignment && <span>请项目负责人或管理员在项目团队中分配启用的对应岗位人员。</span>}
  </div>;
}
