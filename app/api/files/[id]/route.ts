import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../../chatgpt-auth";
import {
  getDocument,
  getRuntimeEnv,
  resolveCurrentUser,
} from "../../../../db/store";
import { hasPermission } from "../../../../lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authenticated = await getChatGPTUser();
  const currentUser = await resolveCurrentUser(
    authenticated?.email ?? null,
    authenticated?.fullName ?? null,
  );
  if (!hasPermission(currentUser.role, "project:view")) {
    return NextResponse.json({ error: "无权访问。" }, { status: 403 });
  }

  const { id } = await context.params;
  const record = await getDocument(id);
  if (!record) {
    return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
  }
  const object = await getRuntimeEnv().FILES?.get(record.objectKey);
  if (!object) {
    return NextResponse.json({ error: "文件对象不存在。" }, { status: 404 });
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": record.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(record.fileName)}`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
