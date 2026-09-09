export const WORKSPACE_ACTOR_HEADER = "X-NPD-Actor";
export const ACTOR_CONTEXT_CHANGED = "ACTOR_CONTEXT_CHANGED";
export const actorContextMessage = "登录账号与当前页面不一致，或页面需要更新。请先复制留存未保存内容，再刷新页面确认账号；本次操作未执行。";

export class NpdWorkspaceIdentityError extends Error {
  constructor(message = "工作区账号已改变，请先复制留存未保存内容，再刷新页面确认账号。当前窗口不会自动切换人员。") {
    super(message);
    this.name = "NpdWorkspaceIdentityError";
  }
}

/** This is a consistency precondition, never a credential or permission grant. */
export function checkWorkspaceActor(request: Request, authenticatedUserId: string): Response | null {
  if (authenticatedUserId && request.headers.get(WORKSPACE_ACTOR_HEADER) === authenticatedUserId) return null;
  return Response.json({ code: ACTOR_CONTEXT_CHANGED, error: actorContextMessage }, {
    status: 409, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Reject a different account before applying its snapshot to open editors. */
export function assertWorkspaceIdentity(expectedId: string, receivedId: string | undefined): void {
  if (!expectedId || receivedId !== expectedId) {
    throw new NpdWorkspaceIdentityError();
  }
}
