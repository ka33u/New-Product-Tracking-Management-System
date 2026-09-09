import { Miniflare } from "miniflare";
import { checkMotorProduction } from "./motor-production.mjs";
const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated motor confirmation test')}}",
  d1Databases: { DB: "isolated-motor-production" }, d1Persist: false });
try { await checkMotorProduction(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
