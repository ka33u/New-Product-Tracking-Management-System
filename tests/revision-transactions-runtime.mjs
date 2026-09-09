import { Miniflare } from "miniflare";
import { checkRevisionTransactions } from "./revision-transactions.mjs";

// No persist path: these checks can never target the user's local database.
const runtime = new Miniflare({ modules: true, compatibilityDate: "2026-05-22", port: 0,
  script: "export default {fetch(){return new Response('isolated revision transaction test')}}",
  d1Databases: { DB: "isolated-revision-transactions" }, d1Persist: false });
try { await checkRevisionTransactions(await runtime.getD1Database("DB")); }
finally { await runtime.dispose(); }
