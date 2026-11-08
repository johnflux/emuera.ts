import { parentPort, workerData } from "node:worker_threads";
import { writeSuspend } from "./suspend-format.js";
import { FileSaveStore, MIDDAY_FILE, type PreparedSaveWrite } from "./storage.js";
import type { Runtime } from "./runtime.js";

export interface QuicksaveJob {
  game: string;
  debug: boolean;
  runtime: ReturnType<Runtime["captureMidday"]>;
  directory?: string;
}
export interface QuicksaveResult {
  encoded?: Uint8Array;
  prepared?: PreparedSaveWrite;
  bytes: number;
  encodeMs: number;
  writeMs: number;
}

const job: QuicksaveJob = workerData;
const started = performance.now();
const runtime = writeSuspend(job.runtime);
const encoded = writeSuspend({ game: job.game, debug: job.debug, runtime });
const serialized = performance.now();
const prepared = job.directory === undefined ? undefined : new FileSaveStore(job.directory).prepareWrite(MIDDAY_FILE, encoded);
const result: QuicksaveResult = {
  ...(prepared ? { prepared } : { encoded }), bytes: encoded.length,
  encodeMs: serialized - started, writeMs: performance.now() - serialized,
};
parentPort!.postMessage(result);
