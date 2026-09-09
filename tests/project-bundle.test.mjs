import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import JSZip from "jszip";
import { Unzip } from "fflate/browser";
const imports = { "fflate/browser": import.meta.resolve("fflate/browser") };
async function compile(name) {
  let code = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [key, value] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(key), JSON.stringify(value));
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  imports[`./${name}`] = url;
  return import(url);
}
await compile("sheets-v2");
const { streamZip, zipContentLength } = await compile("zip-stream");
const { prepareProjectBundle, archiveFileName } = await compile("project-bundle");
const bytes = new TextEncoder().encode("亨达检验报告\n原件字节不变\n");
const base = { project: { id: "p", code: "NP-QA", name: "离线归档测试" }, sheets: [{ code: "verification", version: 4, updatedAt: "2026-09-07 00:00:00" }], documents: [] };
const document = (id, fileName = "同名报告.txt") => ({ id, fileName, objectKey: `npd/p/verification/${id}`, projectId: "p", sheetCode: "verification", size: bytes.length,
  createdAt: "2026-09-07 00:00:00", uploadedByName: "试验员", version: "A1", contentType: "text/plain", motorId: "m", linkedRecordId: id, kind: "test_report" });
function bucketFor(documents) {
  return { heads: 0, gets: 0, async head(key) {
    this.heads++;
    const row = documents.find((item) => item.objectKey === key);
    return row ? { key, size: row.size, etag: key + "-v1" } : null;
  }, async get(key, options) {
    this.gets++;
    assert.equal(options.onlyIf.etagMatches, key + "-v1");
    return { key, size: bytes.length, etag: key + "-v1", body: new Blob([bytes]).stream() };
  } };
}
async function unzip(archive) {
  const buffer = await new Response(archive.body).arrayBuffer();
  assert.equal(buffer.byteLength, archive.length);
  return JSZip.loadAsync(buffer, { checkCRC32: true });
}

test("bundle includes Word, Excel, originals and unambiguous Unicode/version mapping", async () => {
  const documents = [document("a"), document("b"), document("c", "../CON.txt"), document("d", "𠮷".repeat(100) + ".PDF")];
  const bucket = bucketFor(documents);
  const plan = await prepareProjectBundle({ ...base, documents }, bucket, "管理员");
  assert.equal(bucket.heads, 4); assert.equal(bucket.gets, 0);
  const result = await unzip(plan.finish(new Blob(["word-binary"]), new Blob(["xlsx-binary"])));
  assert.equal(await result.file("01_开发程序.docx").async("string"), "word-binary");
  assert.equal(await result.file("02_完整项目数据.xlsx").async("string"), "xlsx-binary");
  const manifest = JSON.parse(await result.file("04_附件清单.json").async("string"));
  assert.equal(manifest.capturedAt, null);
  assert.equal(manifest.consistency, "provided-data");
  assert.equal(manifest.attachmentCount, 4);
  assert.equal(manifest.stageVersions[0].version, 4);
  assert.equal(new Set(manifest.attachments.map((row) => row.path)).size, 4);
  for (const row of manifest.attachments) {
    assert.deepEqual(await result.file(row.path).async("uint8array"), bytes);
    assert.equal(row.version, "A1");
    assert.equal(row.linkedRecordId, row.documentId);
    assert.ok(!row.path.split("/").includes(".."));
    assert.ok(new TextEncoder().encode(row.path.split("/").at(-1)).length < 180);
    assert.equal(row.objectKey, undefined);
  }
  assert.equal(manifest.attachments[2].originalFileName, "../CON.txt");
  assert.match(manifest.attachments[3].path, /\.PDF$/);
  assert.equal(Object.keys(result.files).length, 8);
  assert.match(await result.file("00_归档说明.txt").async("string"), /未加密/);
  assert.equal(bucket.gets, 4);
  assert.equal(archiveFileName("\ud800/\u202e.."), "___");
});

test("archive distinguishes transaction capture time from file generation time", async () => {
  const capturedAt = "2026-09-07T00:00:00.123Z";
  const plan = await prepareProjectBundle({ ...base, capturedAt }, undefined, "当前导出人");
  const result = await unzip(plan.finish(new Blob(), new Blob()));
  const manifest = JSON.parse(await result.file("04_附件清单.json").async("string"));
  assert.equal(manifest.capturedAt, capturedAt);
  assert.equal(manifest.generatedAt, plan.generatedAt);
  assert.equal(manifest.consistency, "d1-single-read-transaction");
  assert.equal(manifest.exportedBy, "当前导出人");
  const readme = await result.file("00_归档说明.txt").async("string");
  assert.match(readme, /数据读取时间/);
  assert.match(readme, /同一次数据库只读事务/);
  assert.match(readme, /不属于数据库事务/);
  assert.doesNotMatch(readme, /跨表并发修改的一致时点保证尚未完成/);
});

test("missing, mismatched or cross-project originals fail before streaming", async () => {
  const doc = document("a");
  const missing = bucketFor([]);
  await assert.rejects(() => prepareProjectBundle({ ...base, documents: [doc] }, missing, "管理员"), /原件缺失/);
  assert.equal(missing.gets, 0);
  await assert.rejects(() => prepareProjectBundle({ ...base, documents: [doc] }, undefined, "管理员"), /未就绪/);
  const mismatch = { ...bucketFor([doc]), async head() { return { size: 1, etag: "v1" }; } };
  await assert.rejects(() => prepareProjectBundle({ ...base, documents: [doc] }, mismatch, "管理员"), /不一致/);
  const foreign = bucketFor([doc]);
  await assert.rejects(() => prepareProjectBundle({ ...base, documents: [{ ...doc, objectKey: "npd/other/private" }] }, foreign, "管理员"), /归属/);
  assert.equal(foreign.heads, 0);
  const empty = await prepareProjectBundle(base, undefined, "管理员");
  const result = await unzip(empty.finish(new Blob(), new Blob()));
  assert.equal(Object.keys(result.files).length, 4);
  assert.equal(JSON.parse(await result.file("04_附件清单.json").async("string")).attachmentCount, 0);
});

test("changed ETags and truncated bodies never finish a valid ZIP", async () => {
  const doc = document("a");
  const changed = { ...bucketFor([doc]), async get() { return { size: doc.size, etag: "v2" }; } };
  const plan = await prepareProjectBundle({ ...base, documents: [doc] }, changed, "管理员");
  await assert.rejects(() => new Response(plan.finish(new Blob(), new Blob()).body).arrayBuffer(), /发生变化/);
  const short = streamZip([{ path: "short.txt", size: 100, open: () => new Blob(["incomplete"]).stream() }]);
  const reader = short.body.getReader();
  const chunks = [];
  await assert.rejects(async () => { while (true) { const next = await reader.read(); if (next.done) break; chunks.push(next.value); } }, /未完整读取/);
  await assert.rejects(() => JSZip.loadAsync(Buffer.concat(chunks)), /end of central directory/);
  const long = streamZip([{ path: "long.txt", size: 1, open: () => new Blob(["too much"]).stream() }]);
  await assert.rejects(() => new Response(long.body).arrayBuffer(), /长度发生变化/);
});

test("streaming uses backpressure and cancellation closes the current input without opening the next", async () => {
  let opened = 0, read = 0, cancelled = 0;
  const entries = ["a", "b"].map((path) => ({ path, size: 128 * 1024, open() {
    opened++;
    return new ReadableStream({ pull(controller) { read++; controller.enqueue(new Uint8Array(64 * 1024)); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  } }));
  const archive = streamZip(entries);
  assert.equal(opened, 0);
  const reader = archive.body.getReader();
  await reader.read();
  assert.equal(opened, 1); assert.equal(read, 1);
  await reader.cancel();
  assert.equal(cancelled, 1); assert.equal(opened, 1);
  for (const path of ["../escape", "/absolute", "a\\b", "C:drive", "a/../b"]) assert.throws(() => zipContentLength([{ path, size: 1 }]));
  assert.throws(() => zipContentLength([{ path: "a", size: 0xffffffff }]), /4GB/);
  assert.throws(() => zipContentLength([{ path: "a", size: 1 }, { path: "A", size: 1 }]), /重复/);
});

test("160 MiB aggregate archive is consumed incrementally without collecting attachment payloads", async () => {
  const size = 20 * 1024 * 1024;
  let readBytes = 0, fileCount = 0, outputBytes = 0;
  const entries = Array.from({ length: 8 }, (_, index) => ({ path: `large-${index}.bin`, size, open() {
    let remaining = size;
    return new ReadableStream({ pull(controller) {
      if (!remaining) { controller.close(); return; }
      const bytes = new Uint8Array(Math.min(64 * 1024, remaining)); bytes.fill(index);
      remaining -= bytes.length; controller.enqueue(bytes);
    } }, { highWaterMark: 0 });
  } }));
  const archive = streamZip(entries);
  const decoder = new Unzip((file) => {
    const index = Number(file.name.match(/\d+/)[0]); let fileSize = 0;
    file.ondata = (error, chunk, final) => {
      assert.ifError(error); fileSize += chunk.length; readBytes += chunk.length;
      if (chunk.length) { assert.equal(chunk[0], index); assert.equal(chunk.at(-1), index); }
      if (final) { fileCount++; assert.equal(fileSize, size); }
    };
    file.start();
  });
  const reader = archive.body.getReader();
  while (true) { const next = await reader.read(); if (next.done) break; outputBytes += next.value.length; decoder.push(next.value); }
  decoder.push(new Uint8Array(), true);
  assert.equal(outputBytes, archive.length); assert.equal(readBytes, size * 8); assert.equal(fileCount, 8);
});
