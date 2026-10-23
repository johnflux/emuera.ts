import { classify, SUPPORTED } from "./compiler.js";
import type { Game } from "./loader.js";
import type { Diagnostic, Line } from "./model.js";

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
    if (!/^#DIMS?\s/i.test(line.text)) record(`Header directive: ${line.text.split(/\s/)[0]}`, line);
    else if (/\b(?:REF|CHARADATA)\b/i.test(line.text)) record("REF/CHARADATA declarations", line);
  }
  for (const routines of game.routines.values()) {
    if (routines.length > 1) record("Duplicate functions / event dispatch", { ...routines[0]!, text: "" });
    for (const routine of routines) {
      functions++;
      for (const directive of routine.directives) {
        if (!/^#DIMS?\s/i.test(directive.text) && !/^#FUNCTIONS?$/i.test(directive.text)) record(`Function directive: ${directive.text.split(/\s/)[0]}`, directive);
        else if (/\b(?:REF|CHARADATA)\b/i.test(directive.text)) record("REF/CHARADATA private declarations", directive);
      }
      for (const line of routine.lines) {
        if (line.text.startsWith("[")) {
          record(`Preprocessor directive: ${line.text}`, line);
          continue;
        }
        const { op } = classify(line);
        if (op === "LABEL") continue;
        instructions++;
        if (op === "ASSIGN" || SUPPORTED.has(op)) supported++;
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
