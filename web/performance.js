/** Opt-in diagnostics; no game text, inputs or credentials are recorded. */
export const profiling = new URLSearchParams(location.search).has("profile");
const samples = [];
export function profileStart() { return profiling ? performance.now() : 0; }
export function profileEnd(name, start, detail) {
  if (!profiling) return;
  samples.push({ name, ms: performance.now() - start, ...detail });
  if (samples.length > 2000) samples.splice(0, samples.length - 2000);
}
export function profileReport() { return structuredClone(samples); }
export function clearProfile() { samples.length = 0; }
