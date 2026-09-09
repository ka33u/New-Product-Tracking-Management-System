import { requireNpdRequestUser } from "../../../request-user";
import { getNpdWorkspaceSnapshot } from "../../../../db/store-v2";
import { buildPortfolioExcel } from "../../../../lib/export-v2";
import { XLSX_MIME } from "../../../../lib/xlsx-runtime";
import { authenticationRequiredResponse } from "../../../../lib/auth-required";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const currentUser = await requireNpdRequestUser();
    const content = await buildPortfolioExcel(await getNpdWorkspaceSnapshot(currentUser), currentUser);
    const fileName = `新品项目概览_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new Response(content, {
      headers: {
        "Content-Type": XLSX_MIME,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const authResponse = authenticationRequiredResponse(error);
    if (authResponse) return authResponse;
    console.error("[NPD] 项目概览导出失败", error);
    return Response.json({ error: "暂时无法导出项目概览，请稍后重试。" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
