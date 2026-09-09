import { Miniflare } from "miniflare";
import { checkCollaborationVersions } from "./collaboration-versions.mjs";

const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated collaboration versions test')}}",
  d1Databases: { DB: "isolated-collaboration-versions" }, d1Persist: false });
try { await checkCollaborationVersions(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
