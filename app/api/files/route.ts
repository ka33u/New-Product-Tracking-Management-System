import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import {
  getRuntimeEnv,
  insertDocument,
  resolveCurrentUser,
} from "../../../db/store";
import { hasPermission } from "../../../lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const authenticated = await getChatGPTUser();
    const currentUser = await resolveCurrentUser(
      authenticated?.email ?? null,
      authenticated?.fullName ?? null,
    );
    if (!hasPermission(currentUser.role, "file:upload")) {
      return NextResponse.json({ error: "当前角色无权上传文件。" }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const projectId = String(formData.get("projectId") || "");
    const formCode = String(formData.get("formCode") || "");
    if (!(file instanceof File) || !projectId) {
      return NextResponse.json(
        { error: "请选择文件并指定项目。" },
        { status: 400 },
      );
    }
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { error: "单个文件不能超过 25MB。" },
        { status: 400 },
      );
    }

    const bucket = getRuntimeEnv().FILES;
    if (!bucket) {
      return NextResponse.json(
        { error: "文件存储尚未绑定。" },
        { status: 503 },
      );
    }
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "-");
    const objectKey = `${projectId}/${crypto.randomUUID()}-${safeName}`;
    await bucket.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: {
        projectId,
        formCode,
        uploadedBy: currentUser.email,
      },
    });
    const id = await insertDocument(
      {
        projectId,
        formCode,
        fileName: file.name,
        objectKey,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      },
      currentUser,
    );
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "文件上传失败。" },
      { status: 500 },
    );
  }
}
