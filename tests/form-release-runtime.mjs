import { Miniflare } from "miniflare";
import { checkFormRelease } from "./form-release.mjs";

const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated form release test')}}",
  d1Databases: { DB: "isolated-form-release" }, d1Persist: false });
try { await checkFormRelease(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
