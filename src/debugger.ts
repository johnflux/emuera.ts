import { z } from "zod";
import { EraError, type Value } from "./model.js";
import type { Expr } from "./expression.js";

const source = z.string().min(1).max(4096);
const page = { search: z.string().max(200).default(""), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100) };
export const debugCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("state"), expressions: z.array(source).max(128).default([]) }),
  z.object({ action: z.literal("variables"), ...page }),
  z.object({ action: z.literal("functions"), ...page }),
  z.object({ action: z.literal("read"), expressions: z.array(source).min(1).max(128) }),
  z.object({ action: z.literal("write"), target: source, value: z.discriminatedUnion("type", [
    z.object({ type: z.literal("integer"), value: z.string().regex(/^-?\d+$/).max(20) }),
    z.object({ type: z.literal("string"), value: z.string().max(100_000) }),
  ]) }),
  z.object({ action: z.literal("evaluate"), expression: source }),
  z.object({ action: z.literal("call"), name: source, arguments: z.array(source).max(64).default([]) }),
  z.object({ action: z.literal("seed"), value: z.string().regex(/^-?\d+$/).max(20) }),
]);
export type DebugCommand = z.infer<typeof debugCommand>;

export function debugValue(value: Value) {
  return { type: typeof value === "bigint" ? "integer" as const : "string" as const, value: String(value) };
}

export function debugInteger(value: string): bigint {
  const parsed = BigInt(value);
  if (BigInt.asIntN(64, parsed) !== parsed) throw new EraError("Debugger integer is outside the signed 64-bit range");
  return parsed;
}

/** Reads and assignment addresses must not invoke functions, consume RAND, or increment variables. */
export function checkDebugRead(expr: Expr): void {
  switch (expr.kind) {
    case "call": case "increment": throw new EraError("Use evaluate or call for expressions with side effects");
    case "variable":
      if (expr.name === "RAND") throw new EraError("Reading RAND changes game state; use evaluate");
      expr.indices.forEach(checkDebugRead);
      break;
    case "binary": checkDebugRead(expr.left); checkDebugRead(expr.right); break;
    case "unary": checkDebugRead(expr.operand); break;
    case "conditional": checkDebugRead(expr.condition); checkDebugRead(expr.yes); checkDebugRead(expr.no); break;
    case "format": expr.parts.forEach(checkDebugRead); break;
    case "interpolation": checkDebugRead(expr.expression); if (expr.width) checkDebugRead(expr.width); break;
  }
}
