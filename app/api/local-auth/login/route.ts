import { NextResponse } from "next/server";
import { authenticateNpdLocalUser, setupNpdLocalAdmin } from "../../../../db/store-v2";
import { isLocalNpdMode, LOCAL_SESSION_COOKIE } from "../../../request-user";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalNpdMode()) return NextResponse.json({ error: "本地登录仅在开发环境启用。" }, { status: 404 });
  const form = await request.formData();
  try {
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
    response.headers.append("Set-Cookie", `${LOCAL_SESSION_COOKIE}=${result.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${result.maxAge}`);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "登录失败。";
    const url = new URL("/", request.url);
    url.searchParams.set("login_error", message);
    return NextResponse.redirect(url, 303);
  }
}
