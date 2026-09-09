import { Miniflare } from "miniflare";
import { checkProjectLifecycle } from "./project-lifecycle.mjs";

const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated lifecycle test')}}",
  d1Databases: { DB: "isolated-project-lifecycle" }, d1Persist: false });
try { await checkProjectLifecycle(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
