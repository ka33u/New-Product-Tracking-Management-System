import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [sourceDir, outputDir] = process.argv.slice(2);
await fs.mkdir(outputDir, { recursive: true });

const files = (await fs.readdir(sourceDir))
  .filter((name) => name.endsWith(".xlsx"))
  .sort();

const manifest = [];

for (const file of files) {
  const workbook = await SpreadsheetFile.importXlsx(
    await FileBlob.load(path.join(sourceDir, file)),
  );
  const summary = await workbook.inspect({
    kind: "workbook,sheet,table,region,drawing,definedName",
    maxChars: 50000,
    tableMaxRows: 80,
    tableMaxCols: 30,
    tableMaxCellChars: 300,
  });

  const stem = path.basename(file, ".xlsx");
  await fs.writeFile(
    path.join(outputDir, `${stem}.ndjson`),
    summary.ndjson,
    "utf8",
  );

  const sheets = [];
  for (const sheet of workbook.worksheets.items) {
    const render = await workbook.render({
      sheetName: sheet.name,
      autoCrop: "all",
      scale: 1.5,
      format: "png",
    });
    const renderPath = path.join(
      outputDir,
      `${stem}-${sheet.name.replaceAll("/", "_")}.png`,
    );
    await fs.writeFile(
      renderPath,
      new Uint8Array(await render.arrayBuffer()),
    );

    const usedRange = sheet.getUsedRange();
    sheets.push({
      name: sheet.name,
      usedRange: usedRange?.address ?? null,
      render: renderPath,
    });
  }

  manifest.push({ file, sheets });
}

await fs.writeFile(
  path.join(outputDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8",
);
console.log(JSON.stringify(manifest, null, 2));
