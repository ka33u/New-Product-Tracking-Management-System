import { Zip, ZipPassThrough } from "fflate/browser";

export interface ZipEntry {
  path: string;
  size: number;
  open: () => Promise<ReadableStream<Uint8Array>> | ReadableStream<Uint8Array>;
}

const encoder = new TextEncoder();
const CHUNK_BYTES = 64 * 1024;

export function zipContentLength(entries: ZipEntry[]) {
  if (entries.length > 65535) throw new Error("归档文件数超出标准ZIP上限，请拆分项目归档。");
  const names = new Set<string>();
  let size = 22;
  for (const entry of entries) {
    const bytes = encoder.encode(entry.path).length;
    if (!entry.path || entry.path.startsWith("/") || entry.path.includes("\\") ||
      entry.path.split("/").some((part) => !part || part === "." || part === "..") ||
      /[:\x00-\x1f]/.test(entry.path) || bytes > 65535 || names.has(entry.path.toLowerCase())) throw new Error("归档文件路径无效或重复。");
    names.add(entry.path.toLowerCase());
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error("归档文件大小无效。");
    // STORE entries, no extra fields/comments: local header + descriptor +
    // central record, with UTF-8 path in both headers; no directory entries.
    size += entry.size + 92 + 2 * bytes;
    if (!Number.isSafeInteger(size) || size >= 0xffffffff) throw new Error("归档大小超出标准ZIP的4GB上限，请拆分项目归档。");
  }
  return size;
}

export function streamZip(entries: ZipEntry[]) {
  const length = zipContentLength(entries);
  let cancelled = false;
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  async function* generate() {
    const queue: Uint8Array[] = [];
    let failure: Error | null = null;
    let written = 0;
    const zip = new Zip((error, bytes) => {
      if (error) failure = error;
      else if (bytes.length) queue.push(bytes);
    });
    function* drain() {
      if (failure) throw failure;
      while (queue.length) {
        const chunk = queue.shift()!;
        written += chunk.length;
        yield chunk;
      }
    }
    try {
      for (const entry of entries) {
        if (cancelled) return;
        const input = await entry.open();
        if (cancelled) { await input.cancel(); return; }
        activeReader = input.getReader();
        const file = new ZipPassThrough(entry.path);
        zip.add(file);
        let read = 0;
        while (!cancelled) {
          const next = await activeReader.read();
          if (cancelled) return;
          if (next.done) break;
          read += next.value.length;
          if (read > entry.size) throw new Error(`附件读取长度发生变化：${entry.path}`);
          for (let offset = 0; offset < next.value.length; offset += CHUNK_BYTES) {
            if (cancelled) return;
            file.push(next.value.subarray(offset, offset + CHUNK_BYTES));
            yield* drain();
          }
        }
        if (cancelled) return;
        if (read !== entry.size) throw new Error(`附件未完整读取：${entry.path}`);
        activeReader.releaseLock(); activeReader = null;
        file.push(new Uint8Array(), true);
        yield* drain();
      }
      if (cancelled) return;
      zip.end();
      yield* drain();
      if (written !== length) throw new Error("归档输出大小校验失败，请重新下载。");
    } finally {
      zip.terminate();
      queue.length = 0;
      if (activeReader) {
        try { await activeReader.cancel(); } finally { activeReader.releaseLock(); activeReader = null; }
      }
    }
  }
  const iterator = generate();
  return { length, body: new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (cancelled) return;
        if (next.done) controller.close(); else controller.enqueue(next.value);
      } catch (error) { if (!cancelled) controller.error(error); }
    },
    async cancel(reason) {
      cancelled = true;
      if (activeReader) await activeReader.cancel(reason);
      await iterator.return();
    },
  }, { highWaterMark: 0 }) };
}
