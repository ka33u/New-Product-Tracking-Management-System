import { zipSync } from "fflate";

// workerd cannot spawn Web Workers. Keep the library's Promise interface but
// compress on the request thread, including worksheet XML above 160 KiB.
// No entries, rows, or historical snapshots are dropped to stay below that size.
export default async function zipXlsx(files: Record<string, Uint8Array>): Promise<ArrayBuffer> {
  return Uint8Array.from(zipSync(files)).buffer;
}
