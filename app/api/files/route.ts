import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  getNpdRuntimeEnv,
  insertNpdDocument,
  resolveNpdCurrentUser,
} from "../../../db/store-v2";
import type { SheetCode } from "../../../lib/npd-v2";
import { sheetByCode } from "../../../lib/sheets-v2";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let objectKey = "";
  try {
    const authenticated = await getChatGPTUser();
    const currentUser = await resolveNpdCurrentUser(
      authenticated?.email ?? null,
      authenticated?.fullName ?? null,
    );
    const formData = await request.formData();
    const file = formData.get("file");
    const projectId = String(formData.get("projectId") || "").trim();
    const sheetCode = String(formData.get("sheetCode") || "").trim() as SheetCode;
    const motorId = String(formData.get("motorId") || "").trim() || null;
    const linkedRecordId = String(formData.get("linkedRecordId") || "").trim() || null;
    const kind = String(formData.get("kind") || "attachment").trim() || "attachment";

    if (!(file instanceof File) || !projectId || !sheetByCode[sheetCode]) {
      return NextResponse.json(
        { error: "请选择文件，并指定有效的项目和 Sheet。" },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "不能上传空文件。" }, { status: 400 });
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "单个文件不能超过 25MB。" }, { status: 400 });
    }

    const bucket = getNpdRuntimeEnv().FILES;
    if (!bucket) {
      return NextResponse.json({ error: "文件存储尚未绑定。" }, { status: 503 });
    }
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-120) || "file";
    objectKey = `npd/${projectId}/${sheetCode}/${crypto.randomUUID()}-${safeName}`;
    await bucket.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: {
        projectId,
        sheetCode,
        motorId: motorId || "",
        kind,
        uploadedBy: currentUser.email,
      },
    });
    const id = await insertNpdDocument(
      {
        projectId,
        sheetCode,
        motorId,
        linkedRecordId,
        kind,
        fileName: file.name,
        objectKey,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      },
      currentUser,
    );
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if (objectKey) {
      try {
        await getNpdRuntimeEnv().FILES?.delete(objectKey);
      } catch {
        // 数据库拒绝附件记录时尽力清理对象，不遮蔽原始错误。
      }
    }
    const message = error instanceof Error ? error.message : "文件上传失败。";
    return NextResponse.json(
      { error: message },
      { status: /无权|只能|停用/.test(message) ? 403 : 400 },
    );
  }
}
