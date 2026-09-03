import { getChatGPTUser } from "../../../chatgpt-auth";
import { getNpdWorkspaceSnapshot, resolveNpdCurrentUser } from "../../../../db/store-v2";
import { buildPortfolioExcel } from "../../../../lib/export-v2";

export const dynamic = "force-dynamic";

export async function GET() {
  const authenticated = await getChatGPTUser();
  const currentUser = await resolveNpdCurrentUser(
    authenticated?.email ?? null,
    authenticated?.fullName ?? null,
  );
  const content = buildPortfolioExcel(await getNpdWorkspaceSnapshot(currentUser), currentUser);
  const fileName = `新品项目概览_${new Date().toISOString().slice(0, 10)}.xls`;
  return new Response(`\uFEFF${content}`, {
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
