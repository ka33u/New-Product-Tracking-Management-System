import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
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
// Miniflare installs SIGINT/SIGTERM hooks that call process.exit() without
// awaiting workerd disposal. Keep it off the signal-owning main thread.
// Older sealed releases predate this bootstrap; their business runtime still
// loads from the verified release, with only the thread bootstrap supplied here.
const workerRoot = selected?.manifest.files.some(file => file.path === "scripts/local-runtime-worker.mjs") ? buildRoot : projectRoot;
const worker = new Worker(path.join(workerRoot, "scripts/local-runtime-worker.mjs"), { workerData: { buildRoot, state, port } });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  console.log("正在停止本地服务，请等待运行进程和数据连接关闭……");
  worker.postMessage({ type: "stop" });
}
const signals = process.platform === "win32" ? ["SIGTERM", "SIGINT", "SIGBREAK"] : ["SIGTERM", "SIGINT"];
for (const signal of signals) process.on(signal, stop);
const onMessage = message => { if (message === "npd:shutdown") stop(); };
if (process.send) process.on("message", onMessage); // Parent-owned IPC, not an HTTP endpoint.
await new Promise(resolve => {
  worker.on("message", message => {
    if (message.type === "ready" && !stopping) console.log(`Ready on ${message.url}`);
    if (message.type === "failure") { console.error(`本地服务失败：${message.error}`); process.exitCode = 1; }
  });
  worker.once("error", error => { console.error("本地运行线程失败：", error); process.exitCode = 1; });
  worker.once("exit", code => {
    for (const signal of signals) process.removeListener(signal, stop);
    process.removeListener("message", onMessage);
    if (code !== 0) process.exitCode = 1;
    if (process.connected) process.disconnect();
    resolve();
  });
});
