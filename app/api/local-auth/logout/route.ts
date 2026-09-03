import { NextResponse } from "next/server";
import { endNpdLocalSession } from "../../../../db/store-v2";
import { isLocalNpdMode, LOCAL_SESSION_COOKIE, readNpdLocalSessionToken } from "../../../request-user";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalNpdMode()) return NextResponse.redirect(new URL("/", request.url), 303);
  await endNpdLocalSession(await readNpdLocalSessionToken());
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.headers.append("Set-Cookie", `${LOCAL_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return response;
}
