import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getNpdProjectArchiveData, resolveNpdCurrentUser } from "../../../../../db/store-v2";
import {
  buildProjectArchiveHtml,
  buildProjectExcel,
  safeExportName,
} from "../../../../../lib/export-v2";
import type { SheetCode } from "../../../../../lib/npd-v2";
import { sheetByCode } from "../../../../../lib/sheets-v2";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const authenticated = await getChatGPTUser();
    const currentUser = await resolveNpdCurrentUser(
      authenticated?.email ?? null,
      authenticated?.fullName ?? null,
    );
    const { id } = await context.params;
    const data = await getNpdProjectArchiveData(id, currentUser);
    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "excel";
    const requestedSheet = url.searchParams.get("sheet") as SheetCode | null;
    if (format === "excel") {
      const fileName = safeExportName(`${data.project.code}_${data.project.name}_完整数据.xls`);
      return new Response(`\uFEFF${buildProjectExcel(data)}`, {
        headers: {
          "Content-Type": "application/vnd.ms-excel; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "private, no-store",
        },
      });
    }
    if (format !== "archive" && format !== "sheet") {
      return NextResponse.json({ error: "不支持的导出格式。" }, { status: 400 });
    }
    const sheetCode: SheetCode | undefined = format === "sheet"
      ? requestedSheet || undefined
      : undefined;
    if (format === "sheet" && (!sheetCode || !sheetByCode[sheetCode])) {
      return NextResponse.json({ error: "请选择有效的 Sheet。" }, { status: 400 });
    }
    const suffix = sheetCode ? sheetByCode[sheetCode].shortTitle : "完整开发程序档案";
    const fileName = safeExportName(`${data.project.code}_${data.project.name}_${suffix}.doc`);
    return new Response(`\uFEFF${buildProjectArchiveHtml(data, sheetCode)}`, {
      headers: {
        "Content-Type": "application/msword; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败。";
    return NextResponse.json(
      { error: message },
      { status: /无权|只能|停用/.test(message) ? 403 : 400 },
    );
  }
}
