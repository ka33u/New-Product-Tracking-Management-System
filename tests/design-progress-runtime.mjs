import { Miniflare } from "miniflare";
import { checkDesignProgress } from "./design-progress.mjs";

const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated design progress test')}}",
  d1Databases: { DB: "isolated-design-progress" }, d1Persist: false });
try { await checkDesignProgress(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
