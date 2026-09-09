import { NextResponse } from "next/server";
import { authenticateNpdLocalUser, setupNpdLocalAdmin } from "../../../../db/store-v2";
import { isLocalNpdMode, LOCAL_SESSION_COOKIE } from "../../../request-user";
import { isSameOriginMutation } from "../../../../lib/request-security";
import { NpdLoginRateLimitError } from "../../../../db/login-limits";
import { LoginRequestError, readLoginForm, localLoginErrorResponse } from "../../../../lib/login-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalNpdMode()) return NextResponse.json({ error: "当前未启用本地账户登录。" }, { status: 404 });
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "请从本系统登录页面提交。" }, { status: 403 });
  }
  try {
    const form = await readLoginForm(request);
    const mode = String(form.get("mode") || "login");
    const result = mode === "setup"
      ? await setupNpdLocalAdmin({
          email: String(form.get("email") || ""), name: String(form.get("name") || ""),
          department: String(form.get("department") || "系统管理"),
          password: String(form.get("password") || ""),
        })
      : await authenticateNpdLocalUser(
          String(form.get("email") || ""), String(form.get("password") || ""),
        );
    const response = NextResponse.redirect(new URL("/", request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.append("Set-Cookie", `${LOCAL_SESSION_COOKIE}=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${result.maxAge}`);
    return response;
  } catch (error) {
    if (error instanceof NpdLoginRateLimitError) return localLoginErrorResponse(request, 429, error.message, error.retryAfterSeconds);
    if (error instanceof LoginRequestError) return localLoginErrorResponse(request, error.status, error.message);
    const message = error instanceof Error ? error.message : "登录失败。";
    const url = new URL("/", request.url);
    url.searchParams.set("login_error", message);
    const response = NextResponse.redirect(url, 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
