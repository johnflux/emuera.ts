import { classify, isSupported } from "./compiler.js";
import { BUILTIN_FUNCTIONS } from "./runtime.js";
import type { Game } from "./loader.js";
import type { Diagnostic, Line } from "./model.js";

const EVENT_FUNCTIONS = new Set(["EVENTFIRST", "EVENTTRAIN", "EVENTSHOP", "EVENTBUY", "EVENTCOM", "EVENTTURNEND", "EVENTCOMEND", "EVENTEND", "EVENTLOAD"]);
export interface Gap { feature: string; count: number; examples: Diagnostic[] }
export function compatibility(game: Game) {
  const gaps = new Map<string, Gap>();
  let instructions = 0, functions = 0, supported = 0;
  const record = (feature: string, line: Line): void => {
    const gap = gaps.get(feature) ?? { feature, count: 0, examples: [] };
    gap.count++;
    if (gap.examples.length < 3) gap.examples.push({ file: line.file, line: line.line, message: feature });
    gaps.set(feature, gap);
  };
  for (const line of game.headers) {
    if (!/^#(?:DIMS?|DEFINE)\s/i.test(line.text)) record(`Header directive: ${line.text.split(/\s/)[0]}`, line);
  }
  for (const [name, routines] of game.routines) {
    // Event functions may be defined repeatedly and are dispatched in #PRI/regular/#LATER order.
    if (routines.length > 1 && !EVENT_FUNCTIONS.has(name)) record("Duplicate non-event functions", { ...routines[0]!, text: "" });
    for (const routine of routines) {
      functions++;
      for (const directive of routine.directives) {
        if (!/^#(?:DIMS?\s|(?:LOCAL|ARG)S?SIZE\s|(?:FUNCTIONS?|PRI|LATER|SINGLE|ONLY)$)/i.test(directive.text.trim())) record(`Function directive: ${directive.text.split(/\s/)[0]}`, directive);
      }
      for (const line of routine.lines) {
        if (line.text.startsWith("[")) {
          record(`Preprocessor directive: ${line.text}`, line);
          continue;
        }
        const { op } = classify(line);
        if (op === "LABEL") continue;
        instructions++;
        // Builtin functions written as statements store their value in RESULT/RESULTS.
        if (op === "ASSIGN" || isSupported(op) || (BUILTIN_FUNCTIONS.has(op) && !game.routines.has(op))) supported++;
        else record(`Instruction: ${op}`, line);
      }
    }
  }
  return {
    scriptFiles: game.scriptFiles, functions, csvTables: game.tables.size, sprites: game.sprites.size,
    instructions, recognizedInstructions: supported,
    note: "Lexical inventory only. Recognized instruction names do not imply support for every argument, expression, variable, preprocessor feature or reachable game path. No playability percentage is implied.",
    gaps: [...gaps.values()].sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature)),
    diagnostics: game.diagnostics.slice(0, 100), diagnosticCount: game.diagnostics.length,
  };
}
