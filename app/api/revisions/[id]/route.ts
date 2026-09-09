import { NextResponse } from "next/server";
import { authenticationRequiredResponse } from "../../../../lib/auth-required";
import { requireNpdRequestUser } from "../../../request-user";
import { getNpdRevisionDetail } from "../../../../db/store-v2";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireNpdRequestUser();
    const detail = await getNpdRevisionDetail((await context.params).id, user);
    return NextResponse.json(detail || { error: "版本不存在。" }, {
      status: detail ? 200 : 404, headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const authResponse = authenticationRequiredResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: error instanceof Error ? error.message : "版本读取失败。" }, {
      status: 403, headers: { "Cache-Control": "no-store" },
    });
  }
}
