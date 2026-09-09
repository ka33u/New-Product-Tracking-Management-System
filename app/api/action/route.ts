import { NextResponse } from "next/server";
import { authenticationRequiredResponse } from "../../../lib/auth-required";
import { checkWorkspaceActor } from "../../../lib/workspace-identity";
import { NpdConflictError } from "../../../db/revision-transaction";
import { isLocalNpdMode, requireNpdRequestUser } from "../../request-user";
import { isSameOriginMutation } from "../../../lib/request-security";
import {
  addPartItem,
  addProjectMotor,
  assignProjectMember,
  confirmPartItem,
  confirmMotorProduction,
  createInspectionRecord,
  createNpdProject,
  createNpdSalesOrder,
  createNpdUser,
  createTestReport,
  linkNpdSalesOrder,
  saveDashboardPreference,
  saveNpdCustomer,
  saveNpdFormRecord,
  setNpdProjectStatus,
  transferNpdProjectOwner,
  updateMotorRequirements,
  updatePartItem,
  updateProjectMotor,
  updateNpdUser,
  updateProjectSheet,
} from "../../../db/store-v2";
import type {
  DashboardPreference,
  SheetCode,
  SheetStatus,
} from "../../../lib/npd-v2";

export const dynamic = "force-dynamic";

type ActionBody =
  | { kind: "confirm_motor"; payload: Parameters<typeof confirmMotorProduction>[0] }
  | { kind: "transfer_project_owner"; payload: Parameters<typeof transferNpdProjectOwner>[0] }
  | { kind: "create_project"; payload: Parameters<typeof createNpdProject>[0] }
  | { kind: "create_order"; payload: Parameters<typeof createNpdSalesOrder>[0] }
  | { kind: "link_order"; payload: { orderId: string; projectId: string | null; expectedProjectId: string | null; expectedVersion: number } }
  | { kind: "add_motor"; payload: { projectId: string; motor: Parameters<typeof addProjectMotor>[1] } }
  | { kind: "update_motor"; payload: { motorId: string; motor: Parameters<typeof updateProjectMotor>[1] } }
  | {
      kind: "update_motor_requirements";
      payload: { motorId: string; inspectionRequirement: string; testRequirement: string; expectedRevision: number };
    }
  | {
      kind: "save_form";
      payload: {
        projectId: string;
        formCode: string;
        expectedVersion: number;
        formPayload: Record<string, unknown>;
        submit: boolean;
        changeReason: string;
      };
    }
  | {
      kind: "update_sheet";
      payload: {
        projectId: string;
        sheetCode: SheetCode;
        expectedVersion: number;
        status: SheetStatus;
        progress: number;
        plannedDate: string;
        note: string;
        changeReason: string;
      };
    }
  | { kind: "add_part"; payload: Parameters<typeof addPartItem>[0] }
  | { kind: "update_part"; payload: { partId: string; part: Parameters<typeof updatePartItem>[1] } }
  | {
      kind: "confirm_part";
      payload: {
        partId: string;
        expectedRevision: number;
        expectedSheetVersion: number;
        status: "in_progress" | "completed" | "blocked";
        note: string;
      };
    }
  | { kind: "save_customer"; payload: Parameters<typeof saveNpdCustomer>[0] }
  | { kind: "create_test_report"; payload: Parameters<typeof createTestReport>[0] }
  | { kind: "create_inspection"; payload: Parameters<typeof createInspectionRecord>[0] }
  | {
      kind: "assign_member";
      payload: { projectId: string; userId: string; responsibility: string; expected: Parameters<typeof assignProjectMember>[4] };
    }
  | {
      kind: "set_project_status";
      payload: { projectId: string; status: "active" | "paused" | "cancelled"; reason: string; expectedStatus: Parameters<typeof setNpdProjectStatus>[4]; expectedLifecycleVersion: number };
    }
  | {
      kind: "create_user";
      payload: Parameters<typeof createNpdUser>[0];
    }
  | {
      kind: "update_user";
      payload: Parameters<typeof updateNpdUser>[0];
    }
  | { kind: "save_dashboard_preference"; payload: DashboardPreference };

export async function POST(request: Request) {
  if (isLocalNpdMode() && !isSameOriginMutation(request)) {
    return NextResponse.json({ error: "请从本系统页面提交操作。" }, { status: 403 });
  }
  try {
    const currentUser = await requireNpdRequestUser();
    if (isLocalNpdMode()) {
      const conflict = checkWorkspaceActor(request, currentUser.id);
      if (conflict) return conflict;
    }
    const body = (await request.json()) as ActionBody;
    if (!body?.kind || !body.payload) {
      return NextResponse.json({ error: "不支持的操作。" }, { status: 400 });
    }
    let result: unknown = null;
    switch (body.kind) {
      case "create_project":
        result = await createNpdProject(body.payload, currentUser);
        break;
      case "create_order":
        result = await createNpdSalesOrder(body.payload, currentUser);
        break;
      case "link_order":
        result = await linkNpdSalesOrder(
          body.payload.orderId,
          body.payload.projectId,
          currentUser,
          body.payload.expectedProjectId,
          body.payload.expectedVersion,
        );
        break;
      case "add_motor":
        result = await addProjectMotor(body.payload.projectId, body.payload.motor, currentUser);
        break;
      case "update_motor":
        result = await updateProjectMotor(body.payload.motorId, body.payload.motor, currentUser);
        break;
      case "update_motor_requirements":
        result = await updateMotorRequirements(
          body.payload.motorId,
          body.payload.inspectionRequirement,
          body.payload.testRequirement,
          currentUser,
          body.payload.expectedRevision,
        );
        break;
      case "save_form":
        result = await saveNpdFormRecord(
          body.payload.projectId,
          body.payload.formCode,
          body.payload.formPayload,
          body.payload.submit,
          currentUser,
          body.payload.changeReason,
          body.payload.expectedVersion,
        );
        break;
      case "update_sheet":
        result = await updateProjectSheet(
          body.payload.projectId,
          body.payload.sheetCode,
          {
            status: body.payload.status,
            progress: body.payload.progress,
            plannedDate: body.payload.plannedDate,
            note: body.payload.note,
            changeReason: body.payload.changeReason,
            expectedVersion: body.payload.expectedVersion,
          },
          currentUser,
        );
        break;
      case "add_part":
        result = await addPartItem(body.payload, currentUser);
        break;
      case "update_part":
        result = await updatePartItem(body.payload.partId, body.payload.part, currentUser);
        break;
      case "confirm_motor":
        result = await confirmMotorProduction(body.payload, currentUser);
        break;
      case "confirm_part":
        result = await confirmPartItem(
          body.payload.partId,
          body.payload.status,
          body.payload.note,
          currentUser,
          body.payload.expectedRevision,
          body.payload.expectedSheetVersion,
        );
        break;
      case "create_test_report":
        result = await createTestReport(body.payload, currentUser);
        break;
      case "save_customer":
        result = await saveNpdCustomer(body.payload, currentUser);
        break;
      case "create_inspection":
        result = await createInspectionRecord(body.payload, currentUser);
        break;
      case "assign_member":
        result = await assignProjectMember(
          body.payload.projectId,
          body.payload.userId,
          body.payload.responsibility,
          currentUser,
          body.payload.expected,
        );
        break;
      case "transfer_project_owner":
        result = await transferNpdProjectOwner(body.payload, currentUser);
        break;
      case "set_project_status":
        result = await setNpdProjectStatus(
          body.payload.projectId,
          body.payload.status,
          body.payload.reason,
          currentUser,
          body.payload.expectedStatus,
          body.payload.expectedLifecycleVersion,
        );
        break;
      case "create_user":
        if (isLocalNpdMode() && !body.payload.password) throw new Error("本地账户必须设置初始密码。");
        result = await createNpdUser(body.payload, currentUser);
        break;
      case "update_user":
        result = await updateNpdUser(body.payload, currentUser);
        break;
      case "save_dashboard_preference":
        result = await saveDashboardPreference(body.payload, currentUser);
        break;
      default: {
        const exhaustive: never = body;
        throw new Error(`不支持的操作：${String((exhaustive as { kind?: string }).kind)}`);
      }
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const authResponse = authenticationRequiredResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "操作失败，请稍后重试。";
    const status = error instanceof NpdConflictError ? 409 : /无权|只有|只能|停用|未开通|尚未开通/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
