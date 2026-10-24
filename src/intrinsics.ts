import { createHash } from "node:crypto";
import { key, numericString, type Routine, type Value } from "./model.js";
import type { Variables } from "./variables.js";
import type { EvaluationContext, Expr } from "./expression.js";

/** A value handed to an ERB function: plain values, an omitted argument, or a REF binding. */
export type IntrinsicArgument = Value | undefined | object;
/** Returned by an intrinsic that declines a call; the ERB routine then runs as written. */
export const DECLINE = Symbol("decline");
export type Intrinsic = (args: IntrinsicArgument[]) => Value | typeof DECLINE;

export interface IntrinsicHost {
  routines: Map<string, Routine[]>;
  /** Runs a user function as an expression function; nested calls still use intrinsics, the named routine's own ERB body runs when `native` is false. */
  call(name: string, args: IntrinsicArgument[], native?: boolean): Value;
  /** The static variables of a routine, if it has run. */
  statics(name: string): Variables | undefined;
  context(variables: Variables): EvaluationContext;
  global(name: string, indices?: number[]): Value;
  characterCount(): number;
}

const literal = (value: Value): Expr => ({ kind: "literal", value });

/** Hashes routine bodies so an intrinsic only replaces the exact ERB it was written against. */
export function routineHash(routines: Map<string, Routine[]>, names: string[]): string | undefined {
  const hash = createHash("sha256");
  for (const name of names) {
    const found = routines.get(name);
    if (found?.length !== 1) return undefined;
    const routine = found[0]!;
    hash.update(`@${routine.name}(${routine.parameters.join(",")})\n`);
    for (const line of [...routine.directives, ...routine.lines]) hash.update(`${line.text}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

/**
 * The eraTW OBJ framework (ERB/OBJ): GET_INT/GET_STR → GET_OBJ → CALLFORMF %CLASS%{ID}(ARG, O_DATA, V_NAME)
 * whose body reports its answer through MAKE_INT/MAKE_STR into the TEMP_STOCK name table, which GET_OBJ then
 * looks up by name and deletes. That round trip is ~40 ERB lines per property read. Natively, GET_OBJ still
 * calls the class function (so RAND order and state reads are unchanged) but MAKE_INT/MAKE_STR for the pending
 * V_NAME hand their value straight back. TEMP_STOCK ends in the same state either way: the entry is created and
 * removed within one GET_OBJ.
 */
const OBJ_ROUTINES = [
  "GET_INT", "GET_STR", "GET_OBJ", "OBJNAME_TO_ID", "GET_EXIST", "OBJ_EXIST",
  "MAKE_INT", "MAKE_STR", "TEMP_VARMAKE", "TEMP_STOCK", "TEMP_GET", "TEMP_INT", "TEMP_STR", "TEMP_RE_INT", "TEMP_RE_STR", "TEMP_VARCLEAR",
];
const OBJ_HASH = "86a0a451cbfbfa72";

interface Capture { name: string; value?: Value }

function objFramework(host: IntrinsicHost): Map<string, Intrinsic> {
  let first: bigint | undefined, last = 0n;
  // Pending V_NAMEs; null marks an ERB-run GET_OBJ whose MAKE_* calls must reach TEMP_STOCK.
  const captures: (Capture | null)[] = [];
  let getStack = 0n, idStack = 0n;
  const classIndex = new Map<string, number>();

  const int = (arg: IntrinsicArgument): bigint | undefined => arg === undefined ? 0n : typeof arg === "bigint" ? arg : undefined;
  const str = (arg: IntrinsicArgument): string | undefined => arg === undefined ? "" : typeof arg === "string" ? arg : undefined;
  const erb = (name: string, args: IntrinsicArgument[]): Value => {
    captures.push(null);
    try { return host.call(name, args, false); } finally { captures.pop(); }
  };
  /** OBJ_ID_FIRST..OBJ_ID_LAST, the range every class id must fall in. */
  const inRange = (id: bigint): boolean => {
    if (first === undefined) { first = host.global("OBJ_ID_FIRST") as bigint; last = host.global("OBJ_ID_LAST") as bigint; }
    return id >= first && id <= last;
  };
  /** TEMP_STOCK's GET_VALUE: the string when non-empty, else the integer as text. */
  const stored = (capture: Capture): string => typeof capture.value === "string" ? capture.value : String(capture.value);

  /** OBJ_EXIST("GET", CLASS_NAME, O_ID) for an in-range id; undefined when ERB should run (and throw). */
  const exists = (className: string, id: bigint): boolean | undefined => {
    const variables = host.statics("OBJ_EXIST");
    if (!className || !variables) return undefined;
    const context = host.context(variables);
    const names = variables.row("CLASS_NAME", [], context);
    let index = classIndex.get(className);
    if (index === undefined || names.get(index) !== className) {
      index = -1;
      for (let i = 1; i < names.size; i++) if (names.get(i) === className) { index = i; break; }
      if (index < 0) return undefined;
      classIndex.set(className, index);
    }
    return variables.row("EXIST", [literal(BigInt(index))], context).get(Number(id)) !== 0n;
  };

  const getObj = (args: IntrinsicArgument[]): string | typeof DECLINE => {
    const arg = int(args[0]), className = str(args[1]), data = str(args[3]);
    let id = int(args[2]);
    if (arg === undefined || className === undefined || id === undefined || data === undefined || args.length > 4) return DECLINE;
    if (className === "キャラデータ" && id < BigInt(host.characterCount())) {
      if (id < 0n) return DECLINE;
      id = host.global("NO", [Number(id)]) as bigint;
    }
    if (!inRange(id)) return "";
    const exist = exists(className, id);
    if (exist === undefined) return DECLINE;
    if (!exist) return "";
    const target = key(`${className}${id}`);
    if (!host.routines.has(target)) return DECLINE;
    getStack++;
    const capture: Capture = { name: `VAR${getStack}_${className}${id}_${data}` };
    captures.push(capture);
    try { host.call(target, [arg, data, capture.name]); }
    finally { captures.pop(); getStack--; }
    return capture.value === undefined ? "" : stored(capture);
  };

  const make = (string: boolean) => (args: IntrinsicArgument[]): Value | typeof DECLINE => {
    const capture = captures.at(-1);
    if (!capture || args.length > 2 || args[0] !== capture.name) return DECLINE;
    const value = string ? str(args[1]) : int(args[1]);
    if (value === undefined) return DECLINE;
    // A second MAKE_* for the same name is TEMP_STOCK's duplicate error; let ERB report it.
    if (capture.value !== undefined) return DECLINE;
    capture.value = value;
    return "";
  };

  return new Map<string, Intrinsic>([
    ["GET_OBJ", (args) => {
      const result = getObj(args);
      return result === DECLINE ? erb("GET_OBJ", args) : result;
    }],
    ["GET_STR", (args) => {
      const result = getObj(args);
      return result === DECLINE ? erb("GET_STR", args) : result;
    }],
    ["GET_INT", (args) => {
      const result = getObj(args);
      if (result === DECLINE) return erb("GET_INT", args);
      return numericString(result) ?? 0n;
    }],
    ["GET_EXIST", (args) => {
      const className = str(args[0]), id = int(args[1]);
      if (className === undefined || id === undefined || !inRange(id) || args.length > 2) return erb("GET_EXIST", args);
      const exist = exists(className, id);
      return exist === undefined ? erb("GET_EXIST", args) : exist ? 1n : 0n;
    }],
    ["OBJNAME_TO_ID", (args) => {
      const arg = int(args[0]), command = str(args[1]), className = str(args[2]), sought = str(args[3]);
      const target = key(`${className}_ID`);
      if (command !== "GET" || arg === undefined || className === undefined || sought === undefined || args.length > 4 || !host.routines.has(target))
        return erb("OBJNAME_TO_ID", args);
      idStack++;
      const capture: Capture = { name: `${className}${idStack}_GET` };
      captures.push(capture);
      try { host.call(target, [arg, sought, capture.name]); }
      finally { captures.pop(); idStack--; }
      // TEMP_RE_INT of a name that was never made is TEMP_STOCK's missing-variable error.
      if (capture.value === undefined) {
        captures.push(null);
        try { return host.call("TEMP_RE_INT", [capture.name], false); } finally { captures.pop(); }
      }
      return numericString(stored(capture)) ?? 0n;
    }],
    ["MAKE_INT", make(false)],
    ["MAKE_STR", make(true)],
  ]);
}

/** Native replacements for known game routines, enabled only when the routine sources hash as expected. */
export function loadIntrinsics(host: IntrinsicHost): { functions: Map<string, Intrinsic>; enabled: string[] } {
  const functions = new Map<string, Intrinsic>();
  const enabled: string[] = [];
  if (routineHash(host.routines, OBJ_ROUTINES) === OBJ_HASH) {
    for (const [name, intrinsic] of objFramework(host)) functions.set(name, intrinsic);
    if (functions.size) enabled.push("OBJ framework (GET_INT/GET_STR/GET_OBJ/OBJNAME_TO_ID/GET_EXIST)");
  }
  return { functions, enabled };
}
