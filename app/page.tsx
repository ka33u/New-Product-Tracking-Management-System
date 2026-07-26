import { getWorkspaceSnapshot, resolveCurrentUser } from "../db/store";
import { permissionsByRole } from "../lib/permissions";
import { getChatGPTUser } from "./chatgpt-auth";
import { NpdApp } from "./components/NpdApp";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "恒达新品开发协同系统",
  description: "面向电机新品开发全流程的项目、订单、评审、验证、变更与档案协同平台。",
};

export default async function Home() {
  const authenticated = await getChatGPTUser();
  const currentUser = await resolveCurrentUser(
    authenticated?.email ?? null,
    authenticated?.fullName ?? null,
  );
  const snapshot = await getWorkspaceSnapshot();

  return (
    <NpdApp
      currentUser={currentUser}
      initialSnapshot={snapshot}
      permissions={permissionsByRole[currentUser.role]}
    />
  );
}
