import { getNpdWorkspaceSnapshot, resolveNpdCurrentUser } from "../db/store-v2";
import { chatGPTSignOutPath, getChatGPTUser } from "./chatgpt-auth";
import { NpdWorkspace } from "./components/NpdWorkspace";

export const dynamic = "force-dynamic";

export const metadata = {
  description: "面向电机新品开发全流程的项目、订单、评审、验证、变更与档案协同平台。",
};

export default async function Home() {
  try {
    const authenticated = await getChatGPTUser();
    const currentUser = await resolveNpdCurrentUser(
      authenticated?.email ?? null,
      authenticated?.fullName ?? null,
    );
    const snapshot = await getNpdWorkspaceSnapshot(currentUser);

    return <NpdWorkspace currentUser={currentUser} initialSnapshot={snapshot} />;
  } catch (error) {
    console.error("[NPD] 工作区初始化失败", error);
    const message = publicStartupMessage(error);

    return <main className="npd2-access-page">
      <section className="npd2-access-card">
        <div className="npd2-access-brand"><span>H</span><div><b>亨达新品开发</b><small>全流程监控系统</small></div></div>
        <span className="npd2-access-icon" aria-hidden="true">!</span>
        <h1>暂时无法进入系统</h1>
        <p>{message}</p>
        <div className="npd2-access-actions">
          <a className="npd2-button npd2-button-primary" href="/">重新加载</a>
          <a className="npd2-button npd2-button-soft" href={chatGPTSignOutPath("/")}>切换登录账号</a>
        </div>
        <small>如刷新后仍未恢复，请将当前时间和页面提示告知管理员。</small>
      </section>
    </main>;
  }
}

function publicStartupMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("账号尚未开通") || message.includes("账号已停用") ||
      message.includes("请先使用 ChatGPT 登录")) {
    return message;
  }
  return "系统正在完成数据初始化，请稍后重新加载。您的项目数据不会因此丢失。";
}
