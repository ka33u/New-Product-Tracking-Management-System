import { NextResponse } from "next/server";
import { requireNpdRequestUser } from "../../../request-user";
import {
  getNpdDocument,
  getNpdRuntimeEnv,
} from "../../../../db/store-v2";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const currentUser = await requireNpdRequestUser();
    const { id } = await context.params;
    const record = await getNpdDocument(id, currentUser);
    if (!record) {
      return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
    }
    const object = await getNpdRuntimeEnv().FILES?.get(record.objectKey);
    if (!object) {
      return NextResponse.json({ error: "文件对象不存在。" }, { status: 404 });
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": record.contentType,
        "Content-Length": String(record.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件读取失败。";
    return NextResponse.json(
      { error: message },
      { status: /无权|只能|停用/.test(message) ? 403 : 400 },
    );
  }
}
