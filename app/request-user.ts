import { headers } from "next/headers";
import type { NpdUser } from "../lib/npd-v2";
import { resolveNpdCurrentUser, resolveNpdLocalSession } from "../db/store-v2";
import { getChatGPTUser } from "./chatgpt-auth";

export const LOCAL_SESSION_COOKIE = "npd_local_session";

export function isLocalNpdMode() {
  return process.env.NODE_ENV !== "production";
}

export async function getNpdRequestUser(): Promise<NpdUser | null> {
  const authenticated = await getChatGPTUser();
  if (authenticated) {
    return resolveNpdCurrentUser(authenticated.email, authenticated.fullName, authenticated.id);
  }
  if (!isLocalNpdMode()) return null;
  const requestHeaders = await headers();
  return resolveNpdLocalSession(readCookie(requestHeaders.get("cookie"), LOCAL_SESSION_COOKIE));
}

export async function requireNpdRequestUser(): Promise<NpdUser> {
  const user = await getNpdRequestUser();
  if (!user) throw new Error(isLocalNpdMode() ? "请先选择本地账户登录。" : "请先使用 ChatGPT 登录。");
  return user;
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const [key, ...rest] = entry.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function readNpdLocalSessionToken() {
  const requestHeaders = await headers();
  return readCookie(requestHeaders.get("cookie"), LOCAL_SESSION_COOKIE);
}
