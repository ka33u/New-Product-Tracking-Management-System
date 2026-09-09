import { Miniflare } from "miniflare";
import { checkCleanDeployment } from "./clean-deployment.mjs";
const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated clean deployment')}}",
  d1Databases: { DB: "isolated-clean-deployment" }, d1Persist: false });
try { await checkCleanDeployment(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
