import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { activeRelease, verifyRelease } from "./local-release.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
let port = 3011, state = path.join(projectRoot, ".wrangler/state"), releaseId = null, useBuild = false;
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--build") useBuild = true;
  else if (arg === "--port" && /^\d+$/.test(args[index + 1] || "")) port = Number(args[++index]);
  else if (arg === "--state" && args[index + 1]) state = path.resolve(args[++index]);
  else if (arg === "--release" && args[index + 1]) releaseId = args[++index];
  else throw new Error("仅支持 --port、--state、--release <版本> 或 --build。");
}
if (!Number.isInteger(port) || port < 0 || port > 65535 || (releaseId && useBuild)) throw new Error("端口或本地版本选项无效。");
const selected = useBuild ? null : releaseId ? { id: releaseId, ...await verifyRelease(releaseId, projectRoot) } : await activeRelease(projectRoot);
const buildRoot = selected?.directory || projectRoot;
console.log(selected ? `使用固定本地版本 ${selected.id}` : "使用当前dist构建（尚未选择固定版本或显式--build）");
const { startLocalRuntime } = await import(pathToFileURL(path.join(buildRoot, "scripts/local-runtime.mjs")).href);
await startLocalRuntime({ buildRoot, state, port });
