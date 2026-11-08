import { Worker } from "node:worker_threads";
import { EraError } from "./model.js";
import type { QuicksaveJob, QuicksaveResult } from "./quicksave-worker.js";

export function backgroundQuicksave(job: QuicksaveJob): Promise<QuicksaveResult> {
  // tsx's main-thread loader is not inherited by a worker's entry point.
  const entry = import.meta.url.endsWith(".ts")
    ? new URL(`data:text/javascript,${encodeURIComponent(
      `import { tsImport } from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))};
await tsImport(${JSON.stringify(new URL("./quicksave-worker.ts", import.meta.url).href)}, ${JSON.stringify(import.meta.url)});`,
    )}`)
    : new URL("./quicksave-worker.js", import.meta.url);
  let worker: Worker;
  const execArgv = process.execArgv.filter((arg, index, args) =>
    !arg.startsWith("--input-type") && args[index - 1] !== "--input-type");
  try { worker = new Worker(entry, { workerData: job, execArgv }); }
  catch (error) {
    throw new EraError(`Cannot start background quicksave: ${error instanceof Error ? error.message : String(error)}`);
  }
  return new Promise((resolve, reject) => {
    let replied = false;
    worker.once("message", (result: QuicksaveResult) => { replied = true; resolve(result); });
    worker.once("error", (error: Error) => reject(new EraError(`Background quicksave failed: ${error.message}`)));
    worker.once("exit", (code) => {
      if (!replied) reject(new EraError(`Background quicksave exited before completing (code ${code})`));
    });
  });
}
