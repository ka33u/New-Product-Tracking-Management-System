import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  createChangeRequest,
  createIssue,
  createProject,
  createSalesOrder,
  decideChangeRequest,
  decideApproval,
  resolveCurrentUser,
  resolveIssue,
  saveFormRecord,
  setOrderLink,
  setProjectPaused,
  terminateProject,
  updateUserAccess,
  updateMilestone,
  verifyChangeRequest,
  waiveMilestone,
} from "../../../db/store";
import type { GateStatus, RoleKey } from "../../../lib/domain";
import { hasPermission, type Permission } from "../../../lib/permissions";

export const dynamic = "force-dynamic";

type ActionBody =
  | { kind: "create_project"; payload: Parameters<typeof createProject>[0] }
  | {
      kind: "update_milestone";
      payload: {
        milestoneId: string;
        status: GateStatus;
        progress: number;
        note: string;
        plannedDate: string;
      };
    }
  | {
      kind: "create_order";
      payload: Parameters<typeof createSalesOrder>[0];
    }
  | {
      kind: "waive_milestone";
      payload: { milestoneId: string; reason: string };
    }
  | {
      kind: "set_project_paused";
      payload: { projectId: string; paused: boolean; reason: string };
    }
  | {
      kind: "terminate_project";
      payload: { projectId: string; reason: string };
    }
  | {
      kind: "set_order_link";
      payload: { orderId: string; projectId: string | null };
    }
  | {
      kind: "decide_approval";
      payload: {
        approvalId: string;
        decision: "approved" | "rejected";
        comment: string;
      };
    }
  | {
      kind: "create_change";
      payload: Parameters<typeof createChangeRequest>[0];
    }
  | {
      kind: "decide_change";
      payload: {
        changeId: string;
        decision: "approved" | "rejected";
        comment: string;
      };
    }
  | {
      kind: "verify_change";
      payload: { changeId: string; verification: string };
    }
  | {
      kind: "create_issue";
      payload: Parameters<typeof createIssue>[0];
    }
  | {
      kind: "resolve_issue";
      payload: { issueId: string; resolution: string };
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
      kind: "update_user";
      payload: {
        userId: string;
        role: RoleKey;
        department: string;
        active: boolean;
      };
    };

const requiredPermission: Record<ActionBody["kind"], Permission> = {
  create_project: "project:create",
  update_milestone: "project:update",
  waive_milestone: "project:tailor",
  set_project_paused: "project:update",
  terminate_project: "project:close",
  create_order: "order:manage",
  set_order_link: "order:link",
  decide_approval: "approval:decide",
  create_change: "change:create",
  decide_change: "change:approve",
  verify_change: "change:approve",
  create_issue: "issue:manage",
  resolve_issue: "issue:manage",
  save_form: "form:edit",
  update_user: "user:manage",
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ActionBody;
    if (
      !body?.kind ||
      !Object.prototype.hasOwnProperty.call(requiredPermission, body.kind) ||
      !body.payload
    ) {
      return NextResponse.json({ error: "不支持的操作。" }, { status: 400 });
    }

    const authenticated = await getChatGPTUser();
    const currentUser = await resolveCurrentUser(
      authenticated?.email ?? null,
      authenticated?.fullName ?? null,
    );
    const permission =
      body.kind === "save_form" && body.payload.submit
        ? "form:submit"
        : requiredPermission[body.kind];

    if (!hasPermission(currentUser.role, permission)) {
      return NextResponse.json(
        { error: `当前角色“${currentUser.roleLabel}”无权执行此操作。` },
        { status: 403 },
      );
    }

    let result: unknown = null;
    switch (body.kind) {
      case "create_project":
        result = await createProject(body.payload, currentUser);
        break;
      case "update_milestone":
        result = await updateMilestone(
          body.payload.milestoneId,
          body.payload.status,
          body.payload.progress,
          body.payload.note,
          body.payload.plannedDate,
          currentUser,
        );
        break;
      case "waive_milestone":
        result = await waiveMilestone(
          body.payload.milestoneId,
          body.payload.reason,
          currentUser,
        );
        break;
      case "set_project_paused":
        result = await setProjectPaused(
          body.payload.projectId,
          body.payload.paused,
          body.payload.reason,
          currentUser,
        );
        break;
      case "terminate_project":
        result = await terminateProject(
          body.payload.projectId,
          body.payload.reason,
          currentUser,
        );
        break;
      case "create_order":
        result = await createSalesOrder(body.payload, currentUser);
        break;
      case "set_order_link":
        result = await setOrderLink(
          body.payload.orderId,
          body.payload.projectId,
          currentUser,
        );
        break;
      case "decide_approval":
        result = await decideApproval(
          body.payload.approvalId,
          body.payload.decision,
          body.payload.comment,
          currentUser,
        );
        break;
      case "create_change":
        result = await createChangeRequest(body.payload, currentUser);
        break;
      case "decide_change":
        result = await decideChangeRequest(
          body.payload.changeId,
          body.payload.decision,
          body.payload.comment,
          currentUser,
        );
        break;
      case "verify_change":
        result = await verifyChangeRequest(
          body.payload.changeId,
          body.payload.verification,
          currentUser,
        );
        break;
      case "create_issue":
        result = await createIssue(body.payload, currentUser);
        break;
      case "resolve_issue":
        result = await resolveIssue(
          body.payload.issueId,
          body.payload.resolution,
          currentUser,
        );
        break;
      case "save_form":
        result = await saveFormRecord(
          body.payload.projectId,
          body.payload.formCode,
          body.payload.formPayload,
          body.payload.submit,
          currentUser,
        );
        break;
      case "update_user":
        result = await updateUserAccess(body.payload, currentUser);
        break;
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "操作失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
