const MAX_LOGIN_BYTES = 8192;
export class LoginRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "LoginRequestError"; }
}

export async function readLoginForm(request: Request): Promise<URLSearchParams> {
  const type = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") throw new LoginRequestError("请从系统登录页面提交账户信息。", 415);
  const declaredSize = request.headers.get("content-length");
  const declaredTooLarge = Boolean(declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_LOGIN_BYTES));
  const reader = request.body?.getReader();
  if (!reader) throw new LoginRequestError("请填写登录信息。", 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LOGIN_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new LoginRequestError("登录信息过长，请返回登录页重新填写。", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (declaredTooLarge) throw new LoginRequestError("登录信息过长，请返回登录页重新填写。", 413);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const form = new URLSearchParams(new TextDecoder().decode(bytes));
  if (!["login", "setup"].includes(form.get("mode") || "login")) throw new LoginRequestError("登录操作无效，请返回登录页。", 400);
  return form;
}

export function localLoginErrorResponse(request: Request, status: number, message: string, retryAfter?: number): Response {
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  if (retryAfter) headers.set("Retry-After", String(retryAfter));
  if (!request.headers.get("accept")?.includes("text/html")) return Response.json({ error: message, retryAfterSeconds: retryAfter }, { status, headers });
  const escaped = message.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>登录提示 · 亨达新品开发</title><style>body{margin:0;background:#f4f7fa;color:#183149;font:1rem/1.7 system-ui,sans-serif}main{box-sizing:border-box;max-width:30rem;margin:12vh auto;padding:2rem;background:white;border:1px solid #dce4ec;border-radius:1rem}h1{font-size:1.5rem}a{display:inline-block;padding:.65rem 1rem;background:#1769aa;color:white;border-radius:.5rem;text-decoration:none}@media(max-width:32rem){main{margin:3rem 1rem}}</style><main><b>亨达新品开发</b><h1>${status === 429 ? "请稍后再登录" : "无法提交登录"}</h1><p role="alert">${escaped}</p><p>已登录人员可以继续使用系统；此提示不会删除项目或账户。</p><a href="/">返回登录页</a></main></html>`, { status, headers });
}
