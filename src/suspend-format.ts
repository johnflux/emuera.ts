import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import { EraError } from "./model.js";

const MAGIC = Buffer.from("ERA-TW-SUSPEND-2\n");
const LEGACY_MAGIC = Buffer.from("ERA-TW-SUSPEND-1\n");
const DIGEST_BYTES = 32;
const digest = (bytes: Buffer): Buffer => createHash("sha256").update(bytes).digest();

/** Internal, versioned V8 data, not an Emuera save or an editable interchange format. */
export function writeSuspend(data: unknown): Buffer {
  try {
    const payload = serialize(data);
    return Buffer.concat([MAGIC, digest(payload), payload]);
  } catch (error) {
    throw new EraError(`Cannot create midday save: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function readSuspend<T>(bytes: Buffer): T {
  const offset = MAGIC.length + DIGEST_BYTES;
  if (bytes.length <= offset || (!bytes.subarray(0, MAGIC.length).equals(MAGIC)
    && !bytes.subarray(0, LEGACY_MAGIC.length).equals(LEGACY_MAGIC)))
    throw new EraError("Unsupported midday save format");
  const payload = bytes.subarray(offset);
  if (!digest(payload).equals(bytes.subarray(MAGIC.length, offset))) throw new EraError("Midday save is damaged");
  try {
    // Callers validate game identity and state before restoration.
    return deserialize(payload) as T;
  } catch (error) {
    throw new EraError(`Cannot decode midday save: ${error instanceof Error ? error.message : String(error)}`);
  }
}
