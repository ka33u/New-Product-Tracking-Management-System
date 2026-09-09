import { headers } from "next/headers";
import type { NpdUser } from "../lib/npd-v2";
import { getNpdRuntimeEnv, resolveNpdCurrentUser, resolveNpdLocalSession } from "../db/store-v2";
import { getChatGPTUser } from "./chatgpt-auth";
import { NpdAuthenticationRequiredError } from "../lib/auth-required";

export const LOCAL_SESSION_COOKIE = "npd_local_session";

export function isLocalNpdMode() {
  const mode = getNpdRuntimeEnv().NPD_AUTH_MODE;
  if (mode === "local") return true;
  if (mode === "chatgpt") return false;
  if (mode) throw new Error("NPD_AUTH_MODE 配置无效，应为 local 或 chatgpt。");
  return process.env.NODE_ENV !== "production";
}

export async function getNpdRequestUser(): Promise<NpdUser | null> {
  if (isLocalNpdMode()) {
    const requestHeaders = await headers();
    return resolveNpdLocalSession(readCookie(requestHeaders.get("cookie"), LOCAL_SESSION_COOKIE));
  }
  const authenticated = await getChatGPTUser();
  if (authenticated) {
    return resolveNpdCurrentUser(authenticated.email, authenticated.fullName, authenticated.id);
  }
  return null;
}

export async function requireNpdRequestUser(): Promise<NpdUser> {
  const user = await getNpdRequestUser();
  if (!user) throw new NpdAuthenticationRequiredError(isLocalNpdMode()
    ? "登录已失效或尚未登录，请重新使用账户密码登录。" : "请先使用 ChatGPT 登录。");
  return user;
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(rest.join("=")); } catch { return null; }
    }
  }
  return null;
}

export async function readNpdLocalSessionToken() {
  const requestHeaders = await headers();
  return readCookie(requestHeaders.get("cookie"), LOCAL_SESSION_COOKIE);
}
