import { Miniflare } from "miniflare";
import { checkLoginSecurity } from "./local-login-security.mjs";
const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-07-23", port: 0,
  script: "export default {fetch(){return new Response('login security test')}}",
  d1Databases: { DB: "login-security-isolated" }, d1Persist: false });
try { await checkLoginSecurity(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
