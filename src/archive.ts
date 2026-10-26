import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { openPromise } from "yauzl";

const MAX_DOWNLOAD = 512 * 1024 * 1024;
const MAX_EXTRACTED = 1024 * 1024 * 1024;
const MAX_ENTRIES = 100_000;

function byteLimit(maximum: number): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maximum ? new Error(`Archive exceeds the ${maximum} byte limit`) : null, chunk);
    },
  });
}

export async function downloadArchive(url: string, destination: string): Promise<void> {
  // GitLab archive endpoints reject fetch's default cross-origin request mode.
  const response = await fetch(url, { mode: "same-origin", signal: AbortSignal.timeout(10 * 60_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ZIP download failed (HTTP ${response.status}). You can download the ZIP manually instead.`);
  }
  if (!response.body) throw new Error("The ZIP download returned no content.");
  if (Number(response.headers.get("content-length")) > MAX_DOWNLOAD) {
    await response.body.cancel();
    throw new Error("The ZIP download exceeds the 512 MiB limit.");
  }
  const reader = response.body.getReader();
  async function* chunks() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  await pipeline(Readable.from(chunks()), byteLimit(MAX_DOWNLOAD), createWriteStream(destination, { flags: "wx" }));
}

/** Extract only regular files/directories into a private staging folder; never follow archive links. */
export async function extractArchive(archive: string, destination: string): Promise<void> {
  const zip = await openPromise(archive, { lazyEntries: true, autoClose: false, strictFileNames: true });
  const root = path.resolve(destination);
  let bytes = 0;
  try {
    if (zip.entryCount > MAX_ENTRIES) throw new Error("ZIP contains too many entries.");
    for await (const entry of zip.eachEntry()) {
      const parts = entry.fileName.split("/");
      if (parts.some((part) => part === ".." || part === "." || part.includes(":") || part.includes("\0")) || entry.fileName.includes("\\")) {
        throw new Error(`Unsafe ZIP path: ${entry.fileName}`);
      }
      const target = path.resolve(root, entry.fileName);
      if (!target.startsWith(root + path.sep)) throw new Error(`ZIP path is outside the game folder: ${entry.fileName}`);
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      const directory = entry.fileName.endsWith("/");
      if (type !== 0 && type !== (directory ? 0o040000 : 0o100000)) throw new Error(`ZIP links and special files are not supported: ${entry.fileName}`);
      if (entry.isEncrypted()) throw new Error("Encrypted ZIP entries are not supported.");
      bytes += entry.uncompressedSize;
      if (bytes > MAX_EXTRACTED) throw new Error("Extracted ZIP exceeds the 1 GiB limit.");
      if (directory) await mkdir(target, { recursive: true });
      else {
        await mkdir(path.dirname(target), { recursive: true });
        const stream = await zip.openReadStreamPromise(entry);
        await pipeline(stream, byteLimit(entry.uncompressedSize), createWriteStream(target, { flags: "wx", mode: 0o600 }));
      }
    }
  } finally { zip.close(); }
}
