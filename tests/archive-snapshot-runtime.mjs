import { Miniflare } from "miniflare";
import { checkArchiveSnapshot } from "./archive-snapshot.mjs";

const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated archive snapshot test')}}",
  d1Databases: { DB: "isolated-archive-snapshot" }, d1Persist: false });
try { await checkArchiveSnapshot(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
