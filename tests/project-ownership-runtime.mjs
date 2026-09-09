import { Miniflare } from "miniflare";
import { checkProjectOwnership } from "./project-ownership.mjs";
const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated owner transfer')}}",
  d1Databases: { DB: "isolated-project-ownership" }, d1Persist: false });
try { await checkProjectOwnership(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
