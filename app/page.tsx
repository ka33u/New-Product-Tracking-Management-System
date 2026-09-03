import { getNpdWorkspaceSnapshot, resolveNpdCurrentUser } from "../db/store-v2";
import { getChatGPTUser } from "./chatgpt-auth";
import { NpdWorkspace } from "./components/NpdWorkspace";

export const dynamic = "force-dynamic";

export const metadata = {
  description: "面向电机新品开发全流程的项目、订单、评审、验证、变更与档案协同平台。",
};

export default async function Home() {
  const authenticated = await getChatGPTUser();
  const currentUser = await resolveNpdCurrentUser(
    authenticated?.email ?? null,
    authenticated?.fullName ?? null,
  );
  const snapshot = await getNpdWorkspaceSnapshot(currentUser);

  return <NpdWorkspace currentUser={currentUser} initialSnapshot={snapshot} />;
}
