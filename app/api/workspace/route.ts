import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getNpdWorkspaceSnapshot, resolveNpdCurrentUser } from "../../../db/store-v2";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authenticated = await getChatGPTUser();
    const currentUser = await resolveNpdCurrentUser(
      authenticated?.email ?? null,
      authenticated?.fullName ?? null,
    );
    return NextResponse.json({
      currentUser,
      snapshot: await getNpdWorkspaceSnapshot(currentUser),
    });
  } catch (error) {
    console.error("[NPD] 工作区刷新失败", error);
    const message = error instanceof Error ? error.message : "";
    const isAccessError = message.includes("账号尚未开通") ||
      message.includes("账号已停用") || message.includes("请先使用 ChatGPT 登录");
    return NextResponse.json(
      { error: isAccessError ? message : "系统正在完成数据初始化，请稍后重试。" },
      { status: isAccessError ? 403 : 503 },
    );
  }
}
