import { Miniflare } from "miniflare";
import { checkStageOriginals } from "./stage-originals.mjs";

const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated stage originals test')}}",
  d1Databases: { DB: "isolated-stage-originals" }, d1Persist: false,
  r2Buckets: { FILES: "isolated-stage-originals" }, r2Persist: false });
try { await checkStageOriginals(await runtime.getD1Database("DB"), await runtime.getR2Bucket("FILES")); }
finally { await runtime.dispose(); }
