import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  addPartItem,
  addProjectMotor,
  assignProjectMember,
  confirmPartItem,
  createInspectionRecord,
  createNpdProject,
  createNpdSalesOrder,
  createNpdUser,
  createTestReport,
  linkNpdSalesOrder,
  resolveNpdCurrentUser,
  saveDashboardPreference,
  saveNpdFormRecord,
  setNpdProjectStatus,
  updateMotorRequirements,
  updateNpdUser,
  updateProjectSheet,
} from "../../../db/store-v2";
import type {
  DashboardPreference,
  NpdRole,
  SheetCode,
  SheetStatus,
} from "../../../lib/npd-v2";

export const dynamic = "force-dynamic";

type ActionBody =
  | { kind: "create_project"; payload: Parameters<typeof createNpdProject>[0] }
  | { kind: "create_order"; payload: Parameters<typeof createNpdSalesOrder>[0] }
  | { kind: "link_order"; payload: { orderId: string; projectId: string | null } }
  | { kind: "add_motor"; payload: { projectId: string; motor: Parameters<typeof addProjectMotor>[1] } }
  | {
      kind: "update_motor_requirements";
      payload: { motorId: string; inspectionRequirement: string; testRequirement: string };
    }
  | {
      kind: "save_form";
      payload: {
        projectId: string;
        formCode: string;
        formPayload: Record<string, unknown>;
        submit: boolean;
      };
    }
  | {
      kind: "update_sheet";
      payload: {
        projectId: string;
        sheetCode: SheetCode;
        status: SheetStatus;
        progress: number;
        plannedDate: string;
        note: string;
      };
    }
  | { kind: "add_part"; payload: Parameters<typeof addPartItem>[0] }
  | {
      kind: "confirm_part";
      payload: {
        partId: string;
        status: "in_progress" | "completed" | "blocked";
        note: string;
      };
    }
  | { kind: "create_test_report"; payload: Parameters<typeof createTestReport>[0] }
  | { kind: "create_inspection"; payload: Parameters<typeof createInspectionRecord>[0] }
  | {
      kind: "assign_member";
      payload: { projectId: string; userId: string; responsibility: string };
    }
  | {
      kind: "set_project_status";
      payload: { projectId: string; status: "active" | "paused" | "cancelled"; reason: string };
    }
  | {
      kind: "create_user";
      payload: Parameters<typeof createNpdUser>[0];
    }
  | {
      kind: "update_user";
      payload: { userId: string; email: string; name: string; role: NpdRole; department: string; active: boolean };
    }
  | { kind: "save_dashboard_preference"; payload: DashboardPreference };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ActionBody;
    if (!body?.kind || !body.payload) {
      return NextResponse.json({ error: "不支持的操作。" }, { status: 400 });
    }
    const authenticated = await getChatGPTUser();
    const currentUser = await resolveNpdCurrentUser(
      authenticated?.email ?? null,
      authenticated?.fullName ?? null,
    );
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
        );
        break;
      case "add_motor":
        result = await addProjectMotor(body.payload.projectId, body.payload.motor, currentUser);
        break;
      case "update_motor_requirements":
        result = await updateMotorRequirements(
          body.payload.motorId,
          body.payload.inspectionRequirement,
          body.payload.testRequirement,
          currentUser,
        );
        break;
      case "save_form":
        result = await saveNpdFormRecord(
          body.payload.projectId,
          body.payload.formCode,
          body.payload.formPayload,
          body.payload.submit,
          currentUser,
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
          },
          currentUser,
        );
        break;
      case "add_part":
        result = await addPartItem(body.payload, currentUser);
        break;
      case "confirm_part":
        result = await confirmPartItem(
          body.payload.partId,
          body.payload.status,
          body.payload.note,
          currentUser,
        );
        break;
      case "create_test_report":
        result = await createTestReport(body.payload, currentUser);
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
        );
        break;
      case "set_project_status":
        result = await setNpdProjectStatus(
          body.payload.projectId,
          body.payload.status,
          body.payload.reason,
          currentUser,
        );
        break;
      case "create_user":
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
    const message = error instanceof Error ? error.message : "操作失败，请稍后重试。";
    const status = /无权|只有|只能|停用|未开通|尚未开通/.test(message) ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
