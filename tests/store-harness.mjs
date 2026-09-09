import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import { applyLocalMigrations } from "../scripts/local-migrations.mjs";

const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_RUNTIME || require.resolve("typescript"));

class Prepared {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Prepared(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return this.database.prepare(this.sql).run(...this.values); }
}
export class D1Adapter {
  constructor() { this.database = new DatabaseSync(":memory:"); this.database.exec("PRAGMA foreign_keys=ON"); }
  prepare(sql) { return new Prepared(this.database, sql); }
  async batch(statements) {
    const results = []; this.database.exec("BEGIN");
    try {
      // Execute synchronously to model an isolated atomic batch: outside reads
      // must never observe half of this transaction in the in-memory adapter.
      for (const statement of statements) {
        if (this.failNextBatchMatching?.test(statement.sql)) {
          this.failNextBatchMatching = null;
          throw new Error("Injected transaction failure");
        }
        const prepared = this.database.prepare(statement.sql);
        if (prepared.columns().length) {
          results.push({ results: prepared.all(...statement.values), success: true, meta: {} });
        } else {
          results.push(prepared.run(...statement.values));
        }
      }
      this.database.exec("COMMIT"); return results;
    }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}
function transpile(source, fileName) {
  return ts.transpileModule(source, { fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler } }).outputText;
}
export async function buildStoreModule(database, runtimeEnv = {}) {
  await applyLocalMigrations(database);
  const context = vm.createContext({ console, crypto, TextEncoder, Date, Intl, JSON, Math, Object, Promise, Map, Set, String, Number, Boolean, Array, Error, RegExp, process: { env: { NODE_ENV: "development" } } });
  const paths = ["/db/store-v2.ts", "/db/login-limits.ts", "/db/revision-transaction.ts", "/lib/evidence-checks.ts", "/lib/dashboard-model.ts", "/lib/npd-v2.ts", "/lib/access-v2.ts", "/lib/forms.ts", "/lib/sheets-v2.ts"];
  const modules = new Map();
  for (const path of paths) {
    const source = await readFile(new URL(`..${path}`, import.meta.url), "utf8");
    modules.set(path, new vm.SourceTextModule(transpile(source, path), { context, identifier: path }));
  }
  // Existing integration fixtures explicitly opt into demo data; clean-deployment
  // tests override this flag. Application runtime has no opt-in by default.
  modules.set("cloudflare:workers", new vm.SyntheticModule(["env"], function initialize() { this.setExport("env", { DB: database, NPD_DEMO_DATA: "1", ...runtimeEnv }); }, { context, identifier: "cloudflare:workers" }));
  const resolve = (specifier, parent) => {
    if (specifier === "cloudflare:workers") return specifier;
    const resolved = new URL(specifier, new URL(parent, "file:///"));
    return resolved.pathname.endsWith(".ts") ? resolved.pathname : `${resolved.pathname}.ts`;
  };
  const linker = async (specifier, referencingModule) => {
    const identifier = resolve(specifier, referencingModule.identifier); const target = modules.get(identifier);
    if (!target) throw new Error(`Cannot resolve ${specifier} from ${referencingModule.identifier} (${identifier})`);
    return target;
  };
  const entry = modules.get("/db/store-v2.ts"); await entry.link(linker); await entry.evaluate(); return entry.namespace;
}
