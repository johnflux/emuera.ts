import { indexScript, type Game } from "./loader.js";
import { demoGame } from "./demo.js";
import { EraError } from "./model.js";
import type { Runtime, Snapshot } from "./runtime.js";
import { GAME_BUTTON_SAMPLES } from "./button-samples.js";

export const COMPONENT_SAMPLES = [
  "buttons", "main", "alone", "time-stopped", "sleep", "inventory", "sheet", "calendar", "relationships", "map",
] as const;
export type ComponentSample = typeof COMPONENT_SAMPLES[number];

export function isComponentSample(value: unknown): value is ComponentSample {
  return typeof value === "string" && COMPONENT_SAMPLES.some((sample) => sample === value);
}

function classHeading(html: string): string {
  const classes = html.match(/^<[^>]*class=['"]([^'"]*)/)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
  if (!classes.length) classes.push("choice");
  const metadata = [...(html.match(/^<[^>]*>/)?.[0] ?? "").matchAll(/\b(data-(?:command-number|suffix))=['"]([^'"]*)['"]/g)]
    .map(([, name, value]) => `<code>[${name}=&quot;${value!.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}&quot;]</code>`);
  return `<div class='era-component-path'>${classes.map(name => `<code>.${name}</code>`).join("")}${metadata.join("")}</div>`;
}

const buttons = `
@SYSTEM_TITLE
${["default", "block", "primary", "list"].map((variant, index) => `
HTML_PRINT "<era-open class='era-section era-helper-samples era-button-sample'>"
PRINTL ${variant === "default" ? "Standard button" : variant === "block" ? "Full-width layout (same button)" : variant === "list" ? "Setting row" : "Primary action"}
HTML_PRINT "${classHeading(`<button class='era-button${variant === "default" ? "" : ` era-button-${variant}`}'></button>`)}"
HTML_PRINT HOTPATCH_BUTTON("Example action", ${100 + index}, "", "${variant}", "", "On", "Example setting description.")
HTML_PRINT "<era-close>"
`).join("")}
${GAME_BUTTON_SAMPLES.map(({ name, html }) => `
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL ${name}
HTML_PRINT "${classHeading(html)}"
HTML_PRINT "${html}"
HTML_PRINT "<era-close>"
`).join("")}
BINPUT
CLEARLINE LINECOUNT
RESTART
`;

/** Fixtures call production ERB helpers; full-screen examples use the existing game's demo scenes. */
export function componentGame(game: Game, sample: ComponentSample): Game {
  if (!game.routines.has("HOTPATCH_BUTTON"))
    throw new EraError("The in-game component workbench requires eraTW with the GUI hotpatches installed");
  if (sample !== "buttons") {
    const preview = demoGame(game);
    if (sample === "map") {
      const move = preview.routines.get("COM400");
      if (!move) throw new EraError("The map preview requires the production movement routine");
      preview.routines.set("COMPONENT_MOVE", move.map(routine => ({ ...routine, name: "COMPONENT_MOVE" })));
      preview.routines.delete("COM400");
      indexScript(preview, `@COM400
#DIM PREPARED
#DIM DYNAMIC ROOM
IF !PREPARED
  ROOM = CFLAG:MASTER:現在位置
  FOR C, 0, CHARANUM
    IF CFLAG:C:現在位置 == ROOM
      CFLAG:C:現在位置 = 9
      CFLAG:C:前ターン位置 = 9
    ENDIF
  NEXT
  PREPARED = 1
ENDIF
RANDOMIZE 1
CALL COMPONENT_MOVE
`, "<component-map>");
    }
    return preview;
  }
  const preview: Game = { ...game, routines: new Map(game.routines), headers: [...game.headers], diagnostics: [] };
  preview.routines.delete("SYSTEM_TITLE");
  indexScript(preview, buttons, "<component-buttons>");
  return preview;
}

function check(snapshot: Snapshot): Snapshot {
  if (snapshot.error) throw new EraError(`Component preview: ${snapshot.error.message}`);
  return snapshot;
}

export function startComponent(runtime: Runtime, sample: ComponentSample): Snapshot {
  const initial = check(runtime.start());
  if (sample === "buttons") return initial;
  if (sample === "relationships") return check(runtime.input("9"));
  check(runtime.input("8"));
  let snapshot = check(runtime.input(sample === "alone" ? "1" : sample === "time-stopped" ? "5" : sample === "sleep" ? "10" : "3"));
  for (let waits = 0; snapshot.input?.kind === "wait" && waits < 40; waits++)
    snapshot = check(runtime.input(""));
  if (snapshot.status !== "waiting" || snapshot.input?.kind !== "integer")
    throw new EraError("Component preview did not reach its command screen");
  if (sample === "inventory") return check(runtime.input("805"));
  if (sample === "sheet") return check(runtime.input("803"));
  if (sample === "calendar") return check(runtime.input("993"));
  if (sample === "map") return check(runtime.input("400"));
  return snapshot;
}
