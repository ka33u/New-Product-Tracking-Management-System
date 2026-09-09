import { NextResponse } from "next/server";
import { getNpdRequestUser } from "../../request-user";
import { getNpdWorkspaceSnapshot } from "../../../db/store-v2";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const currentUser = await getNpdRequestUser();
    if (!currentUser) return NextResponse.json(
      { error: "登录已失效或尚未登录，请重新登录。", code: "AUTH_REQUIRED" },
      { status: 401, headers: privateHeaders },
    );
    const snapshot = await getNpdWorkspaceSnapshot(currentUser);
    const snapshotUser = snapshot.users.find((user) => user.id === currentUser.id);
    if (!snapshotUser) throw new Error("工作区缺少当前账户。");
    return NextResponse.json({
      currentUser: snapshotUser,
      snapshot,
    }, { headers: privateHeaders });
  } catch (error) {
    console.error("[NPD] 工作区刷新失败", error);
    const message = error instanceof Error ? error.message : "";
    const isAccessError = message.includes("账号尚未开通") ||
      message.includes("账号已停用") || message.includes("请先使用 ChatGPT 登录");
    return NextResponse.json(
      { error: isAccessError ? message : "暂时无法读取工作区，请稍后重试。" },
      { status: isAccessError ? 403 : 503, headers: privateHeaders },
    );
  }
}
