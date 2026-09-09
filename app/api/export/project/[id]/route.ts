import { NextResponse } from "next/server";
import { authenticationRequiredResponse } from "../../../../../lib/auth-required";
import { requireNpdRequestUser } from "../../../../request-user";
import { getNpdProjectArchiveData, getNpdRuntimeEnv } from "../../../../../db/store-v2";
import {
  buildProjectExcel,
  safeExportName,
} from "../../../../../lib/export-v2";
import type { SheetCode } from "../../../../../lib/npd-v2";
import { sheetByCode } from "../../../../../lib/sheets-v2";
import { XLSX_MIME } from "../../../../../lib/xlsx-runtime";
import { buildProjectWord } from "../../../../../lib/word-archive";
import { DOCX_MIME } from "../../../../../lib/docx-runtime";
import { prepareProjectBundle } from "../../../../../lib/project-bundle";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const currentUser = await requireNpdRequestUser();
    const { id } = await context.params;
    const data = await getNpdProjectArchiveData(id, currentUser);
    const author = data.exportedBy;
    const url = new URL(request.url);
    const format = url.searchParams.get("format") || "excel";
    const requestedSheet = url.searchParams.get("sheet") as SheetCode | null;
    if (format === "bundle") {
      const plan = await prepareProjectBundle(data, getNpdRuntimeEnv().FILES, author);
      const word = await buildProjectWord(data, undefined, author);
      const excel = await buildProjectExcel(data);
      const archive = plan.finish(word, excel);
      // Workers derives Content-Length from this native stream, not from a
      // manually assigned header. Pipe errors abort the download, not a ZIP EOF.
      const fixed = new FixedLengthStream(archive.length);
      void archive.body.pipeTo(fixed.writable).catch((error) => {
        console.error("[NPD] 离线归档下载中断", error instanceof Error ? error.message : "流读取失败");
      });
      const fileName = `${safeExportName(`${data.project.code}_${data.project.name}_完整离线档案`)}.zip`;
      return new Response(fixed.readable, { headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(archive.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      } });
    }
    if (format === "excel") {
      const fileName = `${safeExportName(`${data.project.code}_${data.project.name}_完整数据`)}.xlsx`;
      return new Response(await buildProjectExcel(data), {
        headers: {
          "Content-Type": XLSX_MIME,
          "X-Content-Type-Options": "nosniff",
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
    if (format === "sheet" && (!sheetCode || !Object.hasOwn(sheetByCode, sheetCode))) {
      return NextResponse.json({ error: "请选择有效的 Sheet。" }, { status: 400 });
    }
    const suffix = sheetCode ? sheetByCode[sheetCode].shortTitle : "完整开发程序档案";
    const fileName = `${safeExportName(`${data.project.code}_${data.project.name}_${suffix}`)}.docx`;
    return new Response(await buildProjectWord(data, sheetCode, author), {
      headers: {
        "Content-Type": DOCX_MIME,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const authResponse = authenticationRequiredResponse(error);
    if (authResponse) return authResponse;
    const message = error instanceof Error ? error.message : "导出失败。";
    return NextResponse.json(
      { error: message },
      { status: /无权|只能|停用/.test(message) ? 403 : 400,
        headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
    );
  }
}
