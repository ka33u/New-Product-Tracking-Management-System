import path from "node:path";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("本地运行线程必须由 local-server.mjs 启动。");
let runtime, stopping = false, cleanup;
function fail(error) {
  parentPort.postMessage({ type: "failure", error: [error?.message || String(error), error?.cause?.message].filter(Boolean).join("\n原因：") });
  process.exitCode = 1;
  parentPort.close();
}
function close() {
  return cleanup ??= Promise.resolve().then(() => runtime?.dispose()).then(() => parentPort.close());
}
parentPort.on("message", message => {
  if (message?.type !== "stop") return;
  stopping = true;
  if (runtime) void close().catch(fail);
});
try {
  const { startLocalRuntime } = await import(pathToFileURL(path.join(workerData.buildRoot, "scripts/local-runtime.mjs")).href);
  runtime = await startLocalRuntime({ ...workerData, announceReady: false });
  if (stopping) await close();
  else parentPort.postMessage({ type: "ready", url: String(await runtime.ready) });
} catch (error) { fail(error); }
