import { NpdAuthenticationRequiredError, writeFailureMessage } from "./auth-required";
import { ACTOR_CONTEXT_CHANGED, actorContextMessage, NpdWorkspaceIdentityError } from "./workspace-identity";

export type WriteNotice = {
  type: "success" | "error" | "warning";
  title?: string;
  message: string;
  persistent?: boolean;
};

export class NpdWriteOutcomeUnknownError extends Error {
  constructor() {
    super("未能确认服务器是否已保存。请先复制留存当前填写内容，再查看最新记录后决定是否重试，不要重复提交或上传。刷新或关闭页面会丢失未保存内容。");
    this.name = "NpdWriteOutcomeUnknownError";
  }
}

/** Never retry a mutation: a lost response does not prove that it was rejected. */
export async function requestWorkspaceWrite(url: string, options: RequestInit) {
  let response: Response;
  try { response = await fetch(url, options); } catch { throw new NpdWriteOutcomeUnknownError(); }
  if (response.status === 401) throw new NpdAuthenticationRequiredError(writeFailureMessage(401, undefined, ""));
  if (response.status >= 500) throw new NpdWriteOutcomeUnknownError();
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    if (response.ok) throw new NpdWriteOutcomeUnknownError();
    throw new Error(`服务器拒绝本次请求（HTTP ${response.status}）。当前填写内容仍保留，请核对后再操作。`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new NpdWriteOutcomeUnknownError();
  const data = parsed as { ok?: boolean; result?: unknown; id?: unknown; error?: string; code?: string };
  if (response.status === 409 && data.code === ACTOR_CONTEXT_CHANGED) {
    throw new NpdWorkspaceIdentityError(actorContextMessage);
  }
  if (response.ok && data.ok !== true) throw new NpdWriteOutcomeUnknownError();
  return { response, data };
}

/** These notices follow an acknowledged write, so must not say it was unexecuted. */
export function savedRefreshNotice(error: unknown, upload = false): WriteNotice {
  const saved = upload ? "附件已上传" : "本次操作已保存";
  const repeat = upload ? "不要重复上传" : "不要重复提交";
  const base = { type: "warning" as const, persistent: true };
  if (error instanceof NpdAuthenticationRequiredError) return { ...base,
    title: "已保存，需重新登录",
    message: `${saved}，但当前登录已失效，${repeat}。请先复制留存其他未保存内容，再重新登录查看最新记录。`,
  };
  if (error instanceof NpdWorkspaceIdentityError) return { ...base,
    title: "已保存，请确认账号",
    message: `${saved}，但登录账号与当前页面不一致，${repeat}。请先复制留存其他未保存内容，再刷新页面确认账号并核对最新记录；当前窗口不会自动切换人员。`,
  };
  return { ...base, title: "已保存，页面待更新",
    message: `${saved}，但最新列表暂时无法读取，${repeat}。请先复制留存其他未保存内容，再刷新页面查看最新记录。`,
  };
}

export function writeErrorNotice(error: unknown, fallback: string): WriteNotice {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof NpdWriteOutcomeUnknownError) return { type: "warning", title: "结果待核对", message, persistent: true };
  if (error instanceof NpdAuthenticationRequiredError || error instanceof NpdWorkspaceIdentityError) {
    return { type: "error", title: "本次操作未执行", message, persistent: true };
  }
  return { type: "error", message };
}
