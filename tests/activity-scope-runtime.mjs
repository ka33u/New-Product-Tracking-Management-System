import { Miniflare } from "miniflare";
import { checkActivityScope } from "./activity-scope.mjs";

const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated activity scope')}}",
  d1Databases: { DB: "isolated-activity-scope" }, d1Persist: false });
try { await checkActivityScope(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
