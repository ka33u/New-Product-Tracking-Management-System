import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getWorkspaceSnapshot, resolveCurrentUser } from "../../../db/store";
import { permissionsByRole } from "../../../lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const authenticated = await getChatGPTUser();
  const currentUser = await resolveCurrentUser(
    authenticated?.email ?? null,
    authenticated?.fullName ?? null,
  );
  return NextResponse.json({
    currentUser,
    permissions: permissionsByRole[currentUser.role],
    snapshot: await getWorkspaceSnapshot(),
  });
}
