// Local cookie-authenticated writes must originate from this exact application
// origin (including port). Never trust forwarded host headers for this check.
export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null" || origin !== new URL(request.url).origin) return false;
  const site = request.headers.get("sec-fetch-site");
  return site !== "cross-site" && site !== "same-site";
}
