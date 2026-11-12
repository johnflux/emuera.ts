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
#DIM RADIO_SELECTION
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Section heading
CALL PRINTLINE("Preferences")
HTML_PRINT "<era-close>"
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
${[
  ["Radio", "Radio choice", 0, "", 1],
  ["Radio selected", "Selected choice", 1, "", 1],
  ["Radio with description", "Choice with help", 0, "Explanation of this choice.", 1],
  ["Radio unavailable", "Unavailable choice", 0, "Requires an unlocked area.", 0],
  ["Radio selected unavailable", "Current unavailable choice", 1, "", 0],
  ["Radio long label", "Bamboo Forest of the Lost", 0, "A longer label without a setup-card dependency.", 1],
].map(([heading, label, selected, description, enabled], index) => `
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL ${heading}
HTML_PRINT "${classHeading("<button class='era-radio'></button>")}"
HTML_PRINT HOTPATCH_RADIO(${9200 + index}, "${label}", ${selected}, "${description}", ${enabled})
HTML_PRINT "<era-close>"
`).join("")}
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Radio group
HTML_PRINT "${classHeading("<div class='era-radio-group'></div>")}"
HTML_PRINT "<era-open class='era-radio-group' role='radiogroup' aria-label='Home example'>"
HTML_PRINT HOTPATCH_RADIO(9100, "Hakurei Shrine", RADIO_SELECTION == 0)
HTML_PRINT HOTPATCH_RADIO(9101, "Bamboo Forest of the Lost", RADIO_SELECTION == 1, "A home among the bamboo.")
HTML_PRINT HOTPATCH_RADIO(9102, "Scarlet Devil Mansion", RADIO_SELECTION == 2, "Requires an unlocked area.", 0)
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Inline native choices
HTML_PRINT "${classHeading("<button class='choice'></button>")}"
HTML_PRINT "<era-open class='era-config era-setup-editor'>"
FOR LOCAL, 0, 8
  PRINTFORM [{LOCAL,3}] Choice {LOCAL}
  SIF (LOCAL + 1) % 4 == 0
    PRINTL
NEXT
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Compact action panel
HTML_PRINT "${classHeading("<div class='era-actions-panel'></div>")}"
HTML_PRINT "<era-open class='era-actions-panel'>"
HTML_PRINT "<era-open class='era-actions-group'>"
PRINTFORMLC [9300] Move
PRINTFORMLC [9301] Go Out
PRINTFORMLC [9302] Lock The Door
PRINTL
HTML_PRINT "<era-close>"
HTML_PRINT "<div class='era-toggles era-auto-toggles'><button value='9303' class='era-toggle' role='checkbox' aria-checked='true'>Auto-TSP Move</button><button value='9304' class='era-toggle' role='checkbox' aria-checked='true'>Auto-Clean</button></div>"
HTML_PRINT "<era-open class='era-settings'>"
HTML_PRINT HOTPATCH_BUTTON("Config", 9305, "", "block")
HTML_PRINT HOTPATCH_BUTTON("Quicksave", 9306, "", "block")
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Player summary
HTML_PRINT "<era-open class='era-card era-player'>"
HTML_PRINT "<div class='era-card-title'><button value='9500' class='era-text-button era-text-button-link' data-suffix='›' title='Click to see more: abilities, experience, personal info and more'>Aesprika<span class='era-tooltip-avatar'><span class='era-face-letter'>A</span></span></button><span class='era-funds'>¥3,764,954</span></div>"
HTML_PRINT "<div class='era-player-kind'>You · Outsider · <span class='era-size era-unusual'>Tall</span></div>"
HTML_PRINT "<div class='era-player-status'><span class='era-status-label'>Status:</span><span class='era-status'>Can eat</span><span class='era-status'>Can bathe</span></div>"
HTML_PRINT "<div class='era-player-status era-player-effects'><span class='era-status-label'>Special:</span><span class='era-status' title='Positive luck modifier; improves luck-dependent activities such as gathering and fishing.'>Fortune</span></div>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Action header
HTML_PRINT "${classHeading("<div class='era-actions-header'></div>")}"
HTML_PRINT "<div class='era-actions-header'><span>Actions</span><span class='era-toggles'><button value='9400' class='era-button'>Filter</button></span></div>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Action collection
HTML_PRINT "${classHeading("<div class='era-actions-collection'></div>")}"
HTML_PRINT "<era-open class='era-actions-collection'>"
HTML_PRINT "<era-open class='era-actions-group'>"
HTML_PRINT "<div class='era-actions-title'>Travel</div>"
HTML_PRINT HOTPATCH_BUTTON("Move", 9401)
HTML_PRINT HOTPATCH_BUTTON("Go Out", 9402)
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-actions-group'>"
HTML_PRINT "<div class='era-actions-title'>Rest</div>"
HTML_PRINT HOTPATCH_BUTTON("Wait", 9403)
HTML_PRINT HOTPATCH_BUTTON("Sleep", 9404)
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Inline action directions
HTML_PRINT "${classHeading("<div class='era-action-direction-group'><span class='era-action-group-label'></span></div>")}"
HTML_PRINT "<era-open class='era-actions-group'>"
${(["give", "receive", "both"] as const).map((direction, i) => `
HTML_PRINT "<era-open class='era-action-direction-group'>"
HTML_PRINT "<span class='era-action-group-label'>${["Give", "Receive", "Both"][i]}</span>"
HTML_PRINT HOTPATCH_BUTTON("${["Caress", "Be Caressed", "Kiss"][i]}", ${[0, 125, 20][i]}, "", "default", "era-action-${direction}")
HTML_PRINT "<era-close>"
`).join("")}
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-section era-button-sample'>"
PRINTL Active panel
HTML_PRINT "${classHeading("<div class='era-actions-body'></div>")}"
HTML_PRINT "${classHeading("<div class='era-card era-in-play'></div>")}"
HTML_PRINT "<era-open class='era-actions-collection'>"
HTML_PRINT "<era-open class='era-actions-body'>"
HTML_PRINT "<era-open class='era-actions-group'>"
HTML_PRINT "<div class='era-actions-title'>Intimate</div>"
HTML_PRINT HOTPATCH_BUTTON("Caress", 0)
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-open class='era-card era-in-play'>"
HTML_PRINT "<div class='era-card-title' title='Ongoing actions and effects. Click an available action to stop it or use it again.'>Active</div>"
HTML_PRINT "<era-open class='era-in-play-item'>"
HTML_PRINT HOTPATCH_BUTTON("Remove Blindfold", 104, "", "block", "era-button-tone-sm")
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
HTML_PRINT "<era-close>"
BINPUT
SIF RESULT >= 9100 && RESULT <= 9101
  RADIO_SELECTION = RESULT - 9100
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
