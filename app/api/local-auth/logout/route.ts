import { NextResponse } from "next/server";
import { endNpdLocalSession } from "../../../../db/store-v2";
import { isLocalNpdMode, LOCAL_SESSION_COOKIE, readNpdLocalSessionToken } from "../../../request-user";
import { isSameOriginMutation } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ error: "请使用系统内的退出按钮。" }, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: Request) {
  if (!isLocalNpdMode()) return NextResponse.redirect(new URL("/", request.url), 303);
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "请从本系统页面退出。" }, { status: 403 });
  }
  await endNpdLocalSession(await readNpdLocalSessionToken());
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.append("Set-Cookie", `${LOCAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
