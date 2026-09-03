import { getNpdLocalAuthState, getNpdWorkspaceSnapshot } from "../db/store-v2";
import { chatGPTSignInPath, chatGPTSignOutPath } from "./chatgpt-auth";
import { NpdWorkspace } from "./components/NpdWorkspace";
import { getNpdRequestUser, isLocalNpdMode } from "./request-user";

export const dynamic = "force-dynamic";

export const metadata = {
  description: "面向电机新品开发全流程的项目、订单、评审、验证、变更与档案协同平台。",
};

export default async function Home({ searchParams }: { searchParams?: Promise<{ login_error?: string }> }) {
  try {
    const currentUser = await getNpdRequestUser();
    if (!currentUser) {
      if (isLocalNpdMode()) return <LocalLogin error={(await searchParams)?.login_error} />;
      return <main className="npd2-access-page"><section className="npd2-access-card">
        <div className="npd2-access-brand"><span>H</span><div><b>亨达新品开发</b><small>全流程监控系统</small></div></div>
        <h1>登录新品开发系统</h1><p>使用企业 ChatGPT 身份登录。首次部署的首位登录人员将自动成为系统管理员。</p>
        <div className="npd2-access-actions"><a className="npd2-button npd2-button-primary" href={chatGPTSignInPath("/")}>登录系统</a></div>
      </section></main>;
    }
    const snapshot = await getNpdWorkspaceSnapshot(currentUser);

    return <NpdWorkspace currentUser={currentUser} initialSnapshot={snapshot}
      signOutPath={isLocalNpdMode() ? "/api/local-auth/logout" : chatGPTSignOutPath("/")} />;
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

async function LocalLogin({ error }: { error?: string }) {
  const { configured } = await getNpdLocalAuthState();
  return <main className="npd2-access-page"><section className="npd2-access-card npd2-local-login">
    <div className="npd2-access-brand"><span>H</span><div><b>亨达新品开发</b><small>本地验收模式</small></div></div>
    <h1>{configured ? "登录本地系统" : "创建首位管理员"}</h1><p>{configured ? "使用管理员已开通的邮箱和本地密码登录。会话 8 小时后自动失效。" : "首次部署需创建管理员账户。完成后，只有管理员能在“人员权限”中开通其他账户。"}</p>
    {error && <div className="npd2-login-error">{error}</div>}
    <form method="post" action="/api/local-auth/login">
      <input type="hidden" name="mode" value={configured ? "login" : "setup"} />
      {!configured && <><label>管理员姓名<input name="name" required autoComplete="name" /></label><label>所属部门<input name="department" required defaultValue="系统管理" /></label></>}
      <label>登录邮箱<input name="email" type="email" required autoComplete="username" defaultValue={configured ? "" : "admin@hengda-motor.local"} /></label>
      <label>登录密码<input name="password" type="password" required minLength={8} maxLength={128} autoComplete={configured ? "current-password" : "new-password"} /></label>
      <small>密码至少 8 位，必须同时包含字母和数字。</small>
      <button className="npd2-button npd2-button-primary" type="submit">{configured ? "登录系统" : "创建管理员并登录"}</button>
    </form>
    <small>密码使用 PBKDF2 加盐哈希保存；正式私有站点使用企业 ChatGPT 身份认证。</small>
  </section></main>;
}

function publicStartupMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("账号尚未开通") || message.includes("账号已停用") ||
      message.includes("请先使用 ChatGPT 登录")) {
    return message;
  }
  return "系统正在完成数据初始化，请稍后重新加载。您的项目数据不会因此丢失。";
}
