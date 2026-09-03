import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getNpdWorkspaceSnapshot, resolveNpdCurrentUser } from "../../../db/store-v2";

export const dynamic = "force-dynamic";

export async function GET() {
  const authenticated = await getChatGPTUser();
  const currentUser = await resolveNpdCurrentUser(
    authenticated?.email ?? null,
    authenticated?.fullName ?? null,
  );
  return NextResponse.json({
    currentUser,
    snapshot: await getNpdWorkspaceSnapshot(currentUser),
  });
}
