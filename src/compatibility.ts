import { classify, isSupported } from "./compiler.js";
import { BUILTIN_FUNCTIONS } from "./runtime.js";
import type { Game } from "./loader.js";
import { key, LITERAL_TEXT_INSTRUCTION, type Diagnostic, type Line } from "./model.js";

// Emuera calls are written NAME( with no space; text such as "Hero (x)" is not a call.
const CALL = /(?<![\p{L}\p{N}_@.$])([\p{L}_][\p{L}\p{N}_]*)\(/gu;
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
  for (const routines of game.routines.values()) {
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
        const { op, args } = classify(line);
        if (op === "LABEL") continue;
        // Instructions we support as statements but not when called as expression functions, e.g. IF CHKDATA(0) == 0.
        const literal = LITERAL_TEXT_INSTRUCTION.test(op);
        if (!literal || op.includes("FORM")) {
          // FORM text is literal apart from its {expr} and %expr% parts.
          const code = literal ? (args.match(/\{[^{}]*\}|%[^%]*%/g) ?? []).join(" ") : args;
          for (const [, name] of code.replace(/"(?:[^"\\]|\\.)*"/g, '""').matchAll(CALL)) {
            const called = key(name!);
            if (isSupported(called) && !BUILTIN_FUNCTIONS.has(called) && !game.routines.has(called)) record(`Expression function (instruction only): ${called}`, line);
          }
        }
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
