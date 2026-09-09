// Run with the bundled artifact Node. The input module was compiled separately
// by the application's TypeScript build tools and resolves docx from the bundle.
import { readFile, writeFile } from "node:fs/promises";
const directory = process.argv[2];
if (!directory) throw new Error("请指定文档验证输入目录。");
const { moduleUrl, outputs } = JSON.parse(await readFile(`${directory}/inputs.json`, "utf8"));
const { buildProjectWord } = await import(moduleUrl);
for (const [name, data, onlySheet] of outputs) {
  const blob = await buildProjectWord(data, onlySheet, "归档验证员");
  await writeFile(`${directory}/${name}`, new Uint8Array(await blob.arrayBuffer()));
  console.log(name, blob.size);
}
