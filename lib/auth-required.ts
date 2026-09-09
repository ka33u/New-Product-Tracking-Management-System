/** Authentication failure is distinct from validation and permission denial. */
export class NpdAuthenticationRequiredError extends Error {
  constructor(message = "登录已失效或尚未登录，请重新登录。") {
    super(message);
    this.name = "NpdAuthenticationRequiredError";
  }
}

export function authenticationRequiredResponse(error: unknown): Response | null {
  if (!(error instanceof NpdAuthenticationRequiredError)) return null;
  return Response.json({ error: error.message, code: "AUTH_REQUIRED" }, {
    status: 401,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** Only failed writes use this copy; a refresh failure may follow a saved write. */
export function writeFailureMessage(status: number, message: string | undefined, fallback: string): string {
  return status === 401
    ? "登录已失效或尚未登录，本次操作未执行。请先复制留存当前填写内容，再重新登录；刷新或关闭页面会丢失未保存内容。"
    : message || fallback;
}
