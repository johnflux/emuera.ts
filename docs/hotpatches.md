# Hotpatches

Hotpatches redesign parts of the game's screen for the browser without editing
the game folder. They are ERB files in [`hotpatch/`](../hotpatch) that are read
after the game loads (`applyHotpatches` in [`src/loader.ts`](../src/loader.ts)).
Unlike [game patches](game-patches.md), which fix genuine bugs in the game, a
hotpatch only changes presentation.

## Rules

- Each `@FUNCTION` in a hotpatch file **replaces** the game's function of the
  same name, including every overload or event variant of it.
- New helper functions must be named `HOTPATCH_*`. Any other name that the game
  does not define is an error, so a typo cannot silently create a dead function.
- Files are loaded in sorted path order. The server logs each replaced function
  at startup (`Hotpatched @…`).
- Use `#DIM DYNAMIC` / `#DIMS DYNAMIC` for locals. Plain `#DIM` locals are
  static in Emuera and keep their values between calls.
- Keep `LINECOUNT` intact: one `HTML_PRINT` is one logical line however many
  rows it wraps to on screen, and the client clears it as one line.
- `npm run dev` watches `hotpatch/` and restarts the server on changes.

## HTML extensions

Hotpatches print HTML with `HTML_PRINT`. On top of Emuera's tags, the browser
accepts three additions that real Emuera does not understand:

| Extension | Meaning |
|-----------|---------|
| `<div>` | A block container (Emuera only has inline elements and `<p>`). |
| `class='era-…'` | Classes in the `era-` namespace are kept and styled in [`web/style.css`](../web/style.css); other classes are dropped. |
| `<meter value='n' max='m'>` | A progress bar, rendered as `span.era-meter` with ARIA meter attributes. |

A `div` with the `era-section` class is a block that wraps to the visible width
of the terminal rather than the game's 149-column logical width.

### Boxes

An `HTML_PRINT` of nothing but `<era-open class='era-…'>` opens a box: every
line printed after it (PRINT, PRINTC, HTML, images) goes into that box until a
matching `HTML_PRINT "<era-close>"`. Boxes nest, so a patched screen can be laid
out in panels with CSS grid or flex, while the lines stay in output order:

- Each marker is a hidden line, because the runtime counts every `HTML_PRINT` as
  one line. `CLEARLINE` therefore removes lines and markers alike; a box left
  empty is removed, and removing a closing marker reopens its box.
- `HTML_PRINT` ends an unfinished PRINT line, so a marker printed after `PRINT`
  text shares that text's logical line.
- A box with the `era-layout` class force-closes any boxes still open, so a
  screen redrawn after `RESTART` or `GOTO` does not end up nested in the old one.
- Inside boxes, the game's line background colours are dropped so the panels
  show through.

Keep opens and closes balanced on every path, including early `RETURN`s.

## Patches

| File | Replaces | Change |
|------|----------|--------|
| `INFO_PALAM.ERB` | `@SHOW_INFO_PALAM` | Palam as a wrapping grid: short name, level, meter, value against the next level's threshold (`1234/2500`, abbreviated as `23.4k/30.0k`) and gain. Zero values are dimmed and the highlighted Palams use the game's yellow. The tooltip shows the full name, a short description of what the Palam is (`HOTPATCH_PALAM_ABOUT`), value, level, "Next level at …" and gems. The collapse toggle and the bars/numbers toggle are dropped. |
| `MAIN_SCREEN.ERB` | `@SHOW_STATUS` | The main screen as panels (`era-main` layout). A header whose backdrop is the sky for the hour, weather and season (`HOTPATCH_SKY`: CSS gradients, clouds, rain/snow, hills; dimmer under a roof, none underground) with the area's landmark in front (`HOTPATCH_AREA`, the map the place is on; one SVG per area in `web/areas/`, drawn blocky through the `era-pixelate` SVG filter in `web/index.html` so it matches the pixel font, e.g. the torii and hall for Hakurei Shrine, bamboo for the Bamboo Forest, the clock tower for the Scarlet Devil Mansion) with the clock (at night a dark dial with radium-green numbers and hands, through the `era-radium` SVG filter in `web/index.html`), the date on a translucent panel and a large **Time Stop** / **Resume Time** button with the TSP gauge built in; the room occupants as a tab rail joined to the character card (names in the game's mood colours as on the character card: blue asleep, pink in heat, orange drunk, aqua happy, red sullen; portrait, name and favour, then how they feel about you as small tags, only when there is something to say (`HOTPATCH_FEELINGS`: their relationship in the character list's words and colours, e.g. Lover, Love, Lust; their Hate Mark level; Mad, or Sad if timid; Sullen or Happy); click to make them the target; the selected tab opens into the card, which is shown as one box with the rail; separate cards when stacked on narrow screens) with the target's Palam below; a card titled with the place (name with its area after it in grey, e.g. "Player's Back Room Hakurei Shrine", furniture, cleanliness) and the room's chatter under it (others' talk, the radio, room descriptions), then the target's portrait (enlarged and set into the card's bottom-left corner; its layers, which the game prints on separate lines, stacked in one place; the time-stop tint, a flat 35% square of Emuera's background colour, applied as a fade of the picture so it does not show as a box on the card; its mouse-over face is the game's own choice, e.g. a smile once they are fond of you), name (in the card-title blue unless the game colours it for their mood) with their species after it in small grey (`PRINT_GET_RACE`, e.g. "Robot"; `RACE_INFO`'s description on hover where the game has one), favour/trust/children/fertility with the relationship, Hate Mark level and Mad/Sad tags after them (as on the tabs), anger (left out when there is none) and sleep state, and Sta/Ene/Mood/Composure meters, then the look text (clothes and what is happening to them; LOOK_AT without its picture and toggles) (or, when nobody else is there, a placeholder with a hint, matched by a "Just you" entry in the list; each row of cards shares one height); a player card with your funds in its title (charisma and bullet money in the tooltip), Stamina/Energy/Vigor meters, a plain "Status:" line (arousal Soft/Hard/Erection!!, hunger and bath such as "Can eat", "Can bathe", sleepiness, and your body stains such as "Hands: Semen", from STAIN_INFO; the target's stains are on a "Stains:" line in their card), the Pushdown Guard toggle (with an explanation) and special states. The game logic before the display (target refresh, events) is kept verbatim. |
| `MAIN_SCREEN_COMMANDS.ERB` | `@SHOW_USERCOM` | The commands as chips grouped under "Interact with *target*" (Talk & Touch, Advances, Activities, Outing, More and the situational "While time is stopped" group) with the command filters as toggles colour-matched to their commands (petting pink, chores green, dialogue blue), each shown only when flipping it would change the listed actions (it tries each flag and restores it) and a ★ Stalk button (follow the target, only with a target), and a "Go & Manage" card for movement, management and settings, starting with "Look after yourself" (Have a Meal and Relax in the Bath, taken out of Activities; Dirtiness/Body Stains [801] is dropped, as the stains are shown on the cards); the condom/moan/standing settings only during a session, mischief, free use or stopped time. Closes the `era-main` layout. While time is stopped the whole screen freezes: frosted cards, desaturated meters (portraits stay in colour, faded by the game's time-stop tint layer), an iced clock. Each toggle's tooltip is one line saying what it shows, e.g. "Petting: Show touching actions she may not welcome (pink)" (the chip is lit when on). The show/hide toggles for the status and commands (3001–3003), the Display Image / Display Settings options and the line padding are dropped. |
| `MAIN_SCREEN_LOOK.ERB` | — | `HOTPATCH_SCENE` and `HOTPATCH_LOOK` split `@LOOK_AT` for the main screen: the room's chatter (ANOTHERTARGET_TALK, 情景描写) goes under the place title, and a verbatim copy of the clothes part goes in the character card, without the [Look] toggle, Display Image/Settings, the picture and the blank padding. `@LOOK_AT` itself is unchanged for its other callers. |
| `SLEEP_MENU.ERB` | `@SHOW_SHOP` | The menu shown while you sleep, before waking, as panels in the main screen's style (`era-shop` layout): the header (sky, area landmark, a clock showing the waking time, the date, "Waking at" with Change [2400] and Calendar [3333] chips, and a large **Wake Up** [100] button); your card (funds, Sta/Ene/Vig/TSP meters, "Fainted"); a Home card (home and area, where you are sleeping if elsewhere, Home Settings [102] and Change Home [120]); "Records & Collections" and "System" cards with the menu grouped (You, Collections; Settings, Guides, Game); the tip at the bottom. Command numbers, the 4-hour minimum sleep check and the greying while fainted are the original's; USERSHOP is unchanged. The DRAWLINE rules and spacing lines are dropped. |
| `MOVE_MAP.ERB` | `@COM400`, `@DRAW_COLOREDMAP`, `@DRAW_MAP` | The Move screen as a card: the map's pages as tabs joined to it (replacing the Change Map arrows; switching a tab, or the map colours, replaces the screen instead of adding another copy to the history), the map (centred in a card of fixed size, so switching pages doesn't resize it; larger maps still grow it), the detection colour key and the room legend (with its spacing kept, at the bottom), and beside it "You are here", a "Return to your room" shortcut, "Walk to" buttons for the adjacent rooms, the senses toggles (Y map colours, Z, X) and the move tasks. The map renderers wrap their rows in an `era-map-art` box keyed by map (see *Map pictures* below) and take an extra `BARE` argument that drops the "== page ==" heading; their other callers (moving home, going out, the region map) keep the heading and also get pictures. Pointing at (or focusing) a room's number on the map, the name printed after it in the map ("16：Worn-out Hut", which the client marks as part of the room and makes clickable), its legend entry, its "Walk to" entry or "You are here" highlights every other one for that room (the client links elements in an `era-move` card by button value or by a `data-room` attribute, which the HTML renderer keeps when it is an integer; this also covers the Go Out and Stroll screens and picture badges). COM400's logic is the original's; the DRAWLINE rules and the [C] display-mode button are dropped. |
| `GO_OUT_MAP.ERB` | `@OTHERREGIONS`, `@COM604` | The Go Out region map and the Explore (Stroll) area map in the same card layout as the Move screen. Region map: the Gensokyo map in a fixed-size card, and beside it "You are here", "Travel to" buttons for every other area with the travel time (minutes, or TSP when travelling in stopped time; dangerous routes in red with a tooltip), and the Time Stop / TSP Movement / Dangerous Paths travel options as toggles (only when travelling alone). Stroll: the area's map, "Walk to" buttons for its spots with their walking time (green when faster, blue when slower than usual, with a note explaining why) and the special warp marked ✧. The two screens are tabs of each other (the area's name and "Gensokyo"), with a Back chip; switching tabs, toggling an option, cancelling the "Use TSP?" question, or returning after a refused move replaces the screen instead of adding another copy to the history. The logic is the original's; the DRAWLINEFORM rules and the bracketed lists are dropped. Pictures come from the `field` and `odekake-<n>` map keys. |

To iterate on the main screen, use the conformance demo's item 8 (Menu → Conformance demo, then `8`): it starts the
game with the hotpatches already on its main screen, alone, with one, two or six people, with time stopped (alone or
with company), with a sleeping partner, exhausted, or outdoors at night in the rain; scenario 10 stays on the sleep menu
(before waking) instead. Restart the demo to pick another scenario.

### Map pictures

Any map can be shown as a picture instead of text art: put `web/maps/<key>.webp` (or `.svg`, `.png`, `.jpg`; the first
of those wins) in place and reload. The keys are `hakurei-1`…`hakurei-4`, `temple-1`/`-2`, `sato-1`…`-4`,
`koumakan-1`…`-4`, `tikurin-1`…`-3`, `forest-1`…`-4`, `meikai-1`…`-5`, `sanroku-1`…`-4`, `summit-1`…`-4`,
`chireiden-1`…`-3`, `tuki-1`…`-4` (the Move screen's pages, from `MAP_VIEWING_NAME`), `odekake-0`…`odekake-10`
(the going-out maps) and `field` (the region map). The page's box has the class `era-map-key-<key>`, so the key can
be checked in the browser's inspector.

The picture has no numbers: the client overlays the room buttons (keeping their detection colours and tooltips) where
they sit in the text map, so a picture traced over a screenshot of the text map, at the same aspect ratio, needs
nothing else. Otherwise add `web/maps/<key>.json`:

```json
{ "width": 780, "rooms": { "9": [[22, 50], [61, 41]], "6": [[70, 20]], "16": [] } }
```

`width` is the picture's width in pixels (default: the text map's); `rooms` maps a room's button value to the badge
positions as percentages of the picture's width and height (several for a room drawn twice, such as an inset building's
inside and outside; `[]` hides it, e.g. for the numbers in a legend column of the text art). Rooms not listed are placed
automatically. A "Text map"/"Picture" switch on the picture flips between them (remembered by the browser), and a
picture that fails to load falls back to the text with a note. The server lists the files at `/api/maps`.
