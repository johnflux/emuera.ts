function button(classes: string, label = "Example action", content = label): string {
  return `<button value='101' class='${classes}'${classes.split(" ").includes("era-unavailable") ? " aria-disabled='true'" : ""}>${content}</button>`;
}
const place = (classes: string, note = "") => button(`era-move-place ${classes}`, "Room",
  `<span class='era-move-num'>9</span><span class='era-move-place-name'>Living Room${note ? `<span class='era-move-place-note'>${note}</span>` : ""}</span>`);

/** Every game button variant is explicit on the control, not inferred from its enclosing screen. */
export const GAME_BUTTON_SAMPLES = [
  ...(["give", "receive", "both"] as const).map((direction, i) => ({
    name: `Action direction / ${direction}`,
    html: `<button value='${[0, 125, 311][i]}' class='era-button era-action-${direction}' data-command-number='${[0, 125, 311][i]}' aria-description='${direction}'>${["Caress", "Be Caressed", "Embrace"][i]}</button>`,
  })),
  ...["chores", "petting", "dialogue", "vaginal", "anal", "sm", "service"].map(tone => ({
    name: `Action / ${tone}`, html: `<button value='101' class='era-button era-button-tone-${tone}' data-command-number='101'>Example action</button>`,
  })),
  ...["era-chip-button", "era-cycle-toggle", "era-star", "era-star era-on", "era-chip-button era-current",
    "era-chip-button era-warn", "era-chip-button era-unavailable",
    "era-text-button", "era-wait-continue", "era-config-stars",
    "era-sheet-step", "era-sheet-page", "era-sheet-page era-current", "era-sheet-subpage",
    "era-sheet-subpage era-current", "era-release-mode", "era-release-mode era-release-quick",
    "era-release-mode era-release-endure",
    "era-setup-character-action", "era-setup-step", "era-setup-number",
    "era-setup-trait", "era-setup-trait era-current"].map(classes => ({ name: classes, html: button(classes) })),
  { name: "Dialog close", html: button("era-dialog-close", "Close", "&#215;") },
  { name: "Sheet person", html: button("era-sheet-person", "Reimu", "Reimu<span class='era-sub'>Shrine maiden</span>") },
  { name: "Sheet person selected", html: "<span class='era-sheet-person era-current'>Reimu<span class='era-sub'>Shrine maiden</span></span>" },
  { name: "Trailing suffix", html: "<button value='805' class='era-button era-button-block' data-command-number='805' data-suffix='›'>Inventory</button>" },
  { name: "Single-line text fitting", html: "<div style='width:180px'><button value='189' class='era-button era-button-block' data-command-number='189'>End Newlywed Play</button></div>" },
  { name: "Travel action", html: button("era-button era-button-block era-travel-button", "Move") },
  { name: "Previous page", html: button("era-chip-button era-page-prev", "Previous") },
  { name: "Next page", html: button("era-chip-button era-page-next", "Next") },
  { name: "Pressed chip", html: "<button value='101' class='era-chip-button' aria-pressed='true'>Enabled</button>" },
  { name: "Inventory row", html: "<button value='101' class='era-inventory-use era-inventory-item' data-command-number='101'><span class='era-inventory-name'>Example item</span><span class='era-inventory-quantity'>3</span></button>" },
  { name: "Calendar icon", html: button("era-chip-button era-calendar-button", "Calendar", "<span class='era-calendar-label'>Calendar</span>") },
  { name: "Calendar person", html: button("era-calendar-person", "Reimu") },
  ...["", "era-calendar-in-week", "era-calendar-month-today", "era-calendar-selected"].map(state => ({
    name: `Calendar date ${state}`, html: button(`era-calendar-month-date ${state}`, "12", "<span>12</span><span class='era-calendar-event-dot'></span><span class='era-calendar-tribute-dot'></span>"),
  })),
  ...["", "era-stopped", "era-wake-button", "era-unavailable"].map(state => {
    const label = state === "era-wake-button" ? "Wake Up" : state === "era-stopped" ? "Resume" : "Time Stop";
    const help = state === "era-wake-button" ? "Start the day at 06:00" : state === "era-unavailable" ? "Not possible now" : "";
    const gauge = state === "era-wake-button" ? "" : "<span class='era-timestop-gauge'><span class='era-meter'><span></span></span><span class='era-timestop-tsp'>TSP 123 / 456</span></span>";
    return { name: `Clock control ${state}`, html: button(`era-timestop-button ${state}`, label,
      `${label}${help ? `<span class='era-sub'>${help}</span>` : ""}${gauge}`) };
  }),
  ...Array.from({ length: 9 }, (_, i) => ({
    name: `Relationship action ${i + 1}`, html: button(`era-relationship-select era-relationship-action-${i + 1}`, "Relationship"),
  })),
  { name: "Predefined character", html: button("era-predefined-character", "Character", "<span class='era-predefined-face'></span><span class='era-predefined-info'><span class='era-predefined-name'>Example character</span><span class='era-predefined-summary'>Character summary</span></span>") },
  { name: "Save slot", html: button("era-save-slot", "Save", "<span class='era-save-slot-number'>1</span><span class='era-save-slot-info'>Saved game</span>") },
  ...["era-title-new", "era-title-load", "era-title-continue"].map(classes => ({ name: classes, html: button(classes) })),
  { name: "Occupant label", html: button("era-occupant-label", "Reimu", "<span class='era-occupant-text'><span class='era-occupant-name'>Reimu</span><span class='era-occupant-state'>Here</span></span>") },
  { name: "Occupant selected", html: "<button value='101' class='era-occupant-label' aria-pressed='true'>Reimu</button>" },
  { name: "Repeat", html: "<button value='101' class='era-repeat' title='Repeat last action' aria-label='Repeat last action'></button>" },
  { name: "Map switch", html: button("era-map-switch", "Text map") },
  { name: "Map Back", html: button("era-button era-move-back", "Back") },
  { name: "Map room marker", html: button("era-map-room", "9") },
  { name: "Map room current", html: button("era-map-room era-map-current-room", "9") },
  { name: "Map room linked", html: button("era-map-room is-linked", "9") },
  { name: "Room (nearby and other-room lists)", html: place("era-move-nearby era-move-more") },
  { name: "Return room", html: place("era-move-return", "Return to your room") },
  { name: "Region exit", html: place("era-move-exit", "The way out to other regions") },
  { name: "Linked place", html: place("is-linked") },
  { name: "Travel destination", html: button("era-move-dest", "Destination", "Destination<span class='era-travel-time'>10 min</span>") },
  { name: "Dangerous travel", html: button("era-move-dest era-travel-danger", "Destination", "Destination<span class='era-travel-time'>20 min</span>") },
  { name: "Legacy text choice", html: button("", "[101] Example") },
  { name: "Compatibility: unpatched PRINTC command tile", html: "<span class='print-cell era-command-tile'>Example action<button value='101' class='command-number-only'>[101]</button></span>" },
] as const;
