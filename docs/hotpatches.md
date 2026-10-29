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
- Helpers that use `CALL` must be ordinary routines, not `#FUNCTION(S)`.
  Return values with `RETURN` and read `RESULT` at the call site; expression
  functions can invoke other expression functions with `CALLF`.
- Keep `LINECOUNT` intact: one `HTML_PRINT` is one logical line however many
  rows it wraps to on screen, and the client clears it as one line.
- `npm run dev` watches `hotpatch/` and restarts the server on changes.

The eraTW main-screen character card uses adjoining Character Info and Interaction
History tabs; history can expand into a read-only dialog showing the full timeline.
Serve Alcohol (332) is omitted when the inventory has no selectable alcohol,
using the same valid-drink list and `IS_ALC` rule as the game's alcohol menu.

## HTML extensions

Hotpatches print HTML with `HTML_PRINT`. On top of Emuera's tags, the browser
accepts three additions that real Emuera does not understand:

| Extension | Meaning |
|-----------|---------|
| `<div>` | A block container. Real Emuera's `<div>` (EM+EE) is a positioned sub-area instead; a `div` with any of its attributes (`width`, `height`, `xpos`, `ypos`, `size`, `rect`, `depth`, `color`, `display`, `margin`, `padding`, `border`, `bcolor`, `radius`) is drawn as one, so hotpatch blocks must not use them. |
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
- A box with the `era-dialog` class is shown as a modal popup (a popover in the
  browser's top layer, over a dimmed backdrop) while its screen is the active
  one, and hidden once the screen becomes history. It stays in place in the
  output, so line counting and `CLEARLINE` work as usual. Escape or a click on
  the backdrop presses the button with the `era-dialog-close` class inside it.

Keep opens and closes balanced on every path, including early `RETURN`s.

## Patches

Below the selected character's **Character Info**, a history placeholder is filled
by the browser with the latest 20 recorded interactions. Its expand/collapse
controls are local UI controls, not ERB command buttons; inspecting history does
not advance the game. The placeholder is one logical HTML line, so `CLEARLINE`
continues to remove it with the rest of the screen. See
[character interaction history](developer-guide.md#eratw-character-interaction-history)
for the initial command coverage, capture semantics, and save checkpoints.

On the main screen, **More...** beside Character Info opens the same room-wide
character sheet as the player's **See more**, but starts on the selected
character without changing the target. `CHARA_SHEET.ERB` also replaces
`@Add_Custom_USERCOM` to handle this presentation-only entry [-9300]; its other
custom-command handling is unchanged. `@TARGET_LIST_STATE` accepts an optional
character to focus and still defaults to the player. The player panel's Inventory
and Pushdown Guard use matching softly bordered controls, with an explicit On/Off
state and space below the guard. Time Stop keeps its translucent background and
adds a 3px backdrop blur.

The sheet heading combines "Character sheet" and the character tabs on one row,
with the viewed character highlighted; only the player's active tab says "You".
Previous/next arrows [77]/[88] remain available
for every multi-character list, including short lists with individual tabs.

| File | Replaces | Change |
|------|----------|--------|
| `ITEM_LIST.ERB` | `@QoL_AllItemSort` (called by `@SHOW_ALLITEM`) | Inventory [805] opens in the same modal system as the character sheet, with category tabs and a compact, responsive list of item names and quantities. Hover or focus an item for its description. A search box inside the footer filters names instantly, case-insensitively and entirely client-side, with a matching-item count and an explicit empty state. The filter persists across category and item-mod views until the dialog closes; clear the textbox to reset it, or select All to search every category. The browser creates the textbox in an `era-inventory-filter` placeholder, without expanding the game HTML allowlist. Return, Escape and backdrop clicks close it; category IDs [3000–3020], Item mods [777], Back to items [889] and Return [999] remain available. The Inventory button is on the player card, retaining the existing command-filter bit 4 visibility rule. |
| `INFO_PALAM.ERB` | `@SHOW_INFO_PALAM` | Palam as a wrapping grid: short name, level, meter, value against the next level's threshold (`1234/2500`, abbreviated as `23.4k/30.0k`) and gain. Zero values are dimmed and the highlighted Palams use the game's yellow. The tooltip shows the full name, a short description of what the Palam is (`HOTPATCH_PALAM_ABOUT`), value, level, "Next level at …" and gems. The collapse toggle and the bars/numbers toggle are dropped. |
| `MAIN_SCREEN.ERB` | `@SHOW_STATUS` | The main screen as panels (`era-main` layout). A header whose backdrop is the sky for the hour, weather and season (`HOTPATCH_SKY`: CSS gradients, clouds, rain/snow, hills; dimmer under a roof, none underground) with the area in front (`HOTPATCH_AREA`, the map the place is on): a pixel-art panorama for the season and time of day where there is one (see [Area pictures](#area-pictures)), otherwise one SVG landmark per area in `web/areas/`, drawn blocky through the `era-pixelate` SVG filter in `web/index.html` so it matches the pixel font, e.g. the torii and hall for Hakurei Shrine, bamboo for the Bamboo Forest, the clock tower for the Scarlet Devil Mansion) with the clock (at night a dark dial with radium-green numbers and hands, through the `era-radium` SVG filter in `web/index.html`), the date on a translucent panel and a large **Time Stop** / **Resume Time** button with the TSP gauge built in; a room card titled with the place (name with its area after it in grey, e.g. "Player's Back Room Hakurei Shrine", furniture, cleanliness) and the room's chatter under it (others' talk, the radio, room descriptions). The occupants stand left to right as borderless sprites beside the selected character's details (at most 400px wide), with the target's Palam below the room card. Each occupant has their name in the game's mood colours (blue asleep, pink in heat, orange drunk, aqua happy, red sullen), favour and state, followed by relationship, Hate Mark and Mad/Sad/Sullen/Happy tags when applicable (`HOTPATCH_FEELINGS`, in the character list's words and colours). Click a sprite or name to select them; a bottom highlight and glow mark the selected person. Portrait layers stack in one place, preserving the game's hover expression and fading the time-stop tint rather than showing its flat square. The selected character's details show their name (card-title blue unless the game colours it for their mood), species (`PRINT_GET_RACE`, with `RACE_INFO` on hover), favour/trust/children/fertility and feelings, anger when nonzero, sleep state, Sta/Ene/Mood/Composure meters and look text (clothes and what is happening to them; LOOK_AT without its picture and toggles). When nobody else is there, a single placeholder and movement hint fill the room stage; each row of cards shares one height. A player card has a "See more" button [803] (the character sheet, below) and your funds in its title (charisma and bullet money in the tooltip), your race and body size on a small grey line under it (`HOTPATCH_PLAYER_KIND`: the sheet's race talents, e.g. "Human", and the size talent, "Normal size" when there is none, highlighted otherwise, e.g. "Inchling" after the mallet), Stamina/Energy/Vigor meters, a plain "Status:" line (arousal Soft/Hard/Erection!!, hunger and bath such as "Can eat", "Can bathe", sleepiness, and your body stains such as "Hands: Semen", from STAIN_INFO; the target's stains are on a "Stains:" line in their card), the Pushdown Guard toggle (with an explanation) and special states. The game logic before the display (target refresh, events) is kept verbatim. |
| `MAIN_SCREEN_COMMANDS.ERB` | `@SHOW_USERCOM` | The commands as chips grouped under "Interact with *target*" (Talk & Touch, Advances, Activities, Outing, More and the situational "While time is stopped" group) with the command filters as toggles colour-matched to their commands (petting pink, chores green, dialogue blue), each shown only when flipping it would change the listed actions (it tries each flag and restores it) and a ★ Stalk button (follow the target, only with a target), and a "Go & Manage" card for movement, management and settings, starting with "Look after yourself" (Have a Meal and Relax in the Bath, taken out of Activities; Dirtiness/Body Stains [801] is dropped, as the stains are shown on the cards; Abilities [803] and Abilities (Master) [804] are dropped for the player card's "See more", though both numbers still work); the condom/moan/standing settings only during a session, mischief, free use or stopped time. Closes the `era-main` layout. While time is stopped the whole screen freezes: frosted cards, desaturated meters (portraits stay in colour, faded by the game's time-stop tint layer), an iced clock. Each toggle's tooltip is one line saying what it shows, e.g. "Petting: Show touching actions she may not welcome (pink)" (the chip is lit when on). The show/hide toggles for the status and commands (3001–3003), the Display Image / Display Settings options and the line padding are dropped. |
| `MAIN_SCREEN_LOOK.ERB` | — | `HOTPATCH_SCENE` and `HOTPATCH_LOOK` split `@LOOK_AT` for the main screen: the room's chatter (ANOTHERTARGET_TALK, 情景描写) goes under the place title, and a verbatim copy of the clothes part goes in the character card, without the [Look] toggle, Display Image/Settings, the picture and the blank padding. `@LOOK_AT` itself is unchanged for its other callers. |
| `CHARA_SHEET.ERB` | `@SINGLE_CHARA_STATE_TR`, `@LIST_CHARA_STATE_TR`, `@TARGET_LIST_STATE`, `@BASIC_STATE`, `@SHOW_FALL_STATE_REV_REQUIREMENTS_TR`, `@CHARA_STATE_TR`, `@PRINT_ABL_MOD` | The character status screens (Abilities [803]/[804] and "See more" on the main screen, Abilities [101] on the sleep menu, and the other callers) as an `era-dialog` popup. Its header has the people as tabs (you first, then the room's occupants, each switched with one click) or, for long lists such as the sleep menu's whole roster, ‹ › arrows around the name and "3 / 165", plus a × close button; then the pages as tabs (Clothes & Abilities, Exp & Gems, Personal Info, Preferences, Body, Falling Conditions, or Skill Acquisition for you, and Character Settings where the game offers it). The game's `CHARA_STATE_TR` page scrolls in the body, and the Choose/Return buttons of the final check before starting stay in a footer. The input loops are the original's. `@TARGET_LIST_STATE` opens on you rather than on the target. `@BASIC_STATE`, the top of every page, is verbatim except for the Sta/Ene/Drunk/Vig/TSP bars, which the game prints with uneven spacing: they are the main screen's meters in a two-column grid, with value / maximum (aqua when buffed, yellow when debuffed, as in the game); the heavy rule it opens with is hidden in the dialog, under the header's border. `@SHOW_FALL_STATE_REV_REQUIREMENTS_TR` (Falling Conditions / Skill Acquisition) prints its page buttons (Body Parts, Skill Acquisition, …, [3500 + n]) as sub-tabs above the list instead of a row under it. `@CHARA_STATE_TR` and `@PRINT_ABL_MOD` (only the sheet calls them) tidy the Clothes & Abilities page: "Unmeasured" and the Abilities table get the Clothing labels' indent, and Personality the blank line above it that the other sections have (its rows stay one column further left, in `PRINT_STATE_TALENT_TR`). |
| `SLEEP_MENU.ERB` | `@SHOW_SHOP` | The menu shown while you sleep, before waking, as panels in the main screen's style (`era-shop` layout): the header (sky, area landmark, a clock showing the waking time, the date, "Waking at" with Change [2400] and Calendar [3333] chips, and a large **Wake Up** [100] button); your card (funds, Sta/Ene/Vig/TSP meters, "Fainted"); a Home card (home and area, where you are sleeping if elsewhere, Home Settings [102] and Change Home [120]); "Records & Collections" and "System" cards with the menu grouped (You, Collections; Settings, Guides, Game); the tip at the bottom. Command numbers, the 4-hour minimum sleep check and the greying while fainted are the original's; USERSHOP is unchanged. The DRAWLINE rules and spacing lines are dropped. |
| `MOVE_MAP.ERB` | `@COM400`, `@DRAW_COLOREDMAP`, `@DRAW_MAP` | The Move screen as a card: the map's pages as tabs joined to it (replacing the Change Map arrows; switching a tab, or the map colours, replaces the screen instead of adding another copy to the history), the map (centred in a card of fixed size, so switching pages doesn't resize it; larger maps still grow it), the detection colour key and the room legend (with its spacing kept, at the bottom), and beside it "You are here", a "Return to your room" shortcut, "Walk to" buttons for the adjacent rooms, the senses toggles (Y map colours, Z, X) and the move tasks. The map renderers wrap their rows in an `era-map-art` box keyed by map (see *Map pictures* below) and take an extra `BARE` argument that drops the "== page ==" heading; their other callers (moving home, going out, the region map) keep the heading and also get pictures. Pointing at (or focusing) a room's number on the map, the name printed after it in the map ("16：Worn-out Hut", which the client marks as part of the room and makes clickable), its legend entry, its "Walk to" entry or "You are here" highlights every other one for that room (the client links elements in an `era-move` card by button value or by a `data-room` attribute, which the HTML renderer keeps when it is an integer; this also covers the Go Out and Stroll screens and picture badges). COM400's logic is the original's; the DRAWLINE rules and the [C] display-mode button are dropped. |
| `GO_OUT_MAP.ERB` | `@OTHERREGIONS`, `@COM604` | The Go Out region map and the Explore (Stroll) area map in the same card layout as the Move screen. Region map: the Gensokyo map in a fixed-size card, and beside it "You are here", "Travel to" buttons for every other area with the travel time (minutes, or TSP when travelling in stopped time; dangerous routes in red with a tooltip), and the Time Stop / TSP Movement / Dangerous Paths travel options as toggles (only when travelling alone). Stroll: the area's map, "Walk to" buttons for its spots with their walking time (green when faster, blue when slower than usual, with a note explaining why) and the special warp marked ✧. The two screens are tabs of each other (the area's name and "Gensokyo"), with a Back chip; switching tabs, toggling an option, cancelling the "Use TSP?" question, or returning after a refused move replaces the screen instead of adding another copy to the history. The logic is the original's; the DRAWLINEFORM rules and the bracketed lists are dropped. Pictures come from the `field` and `odekake-<n>` map keys. |

Room Occupants also shows Shinmyoumaru when she is in her cage and you are in
the home living room or veranda, matching `COM_ABLE428`'s remote-access locations.
Her cage entry has a muted portrait, says "In her cage · Miracle
Mallet only" (plus "Asleep" when applicable), and cannot be clicked to select her.
It remains visible during sleep or mallet cooldown: it indicates her presence,
not command availability. If she is already listed as accompanying or being
carried, no duplicate cage entry is added.

The room occupants and selected character's details share one room card, split
into a scene on the left and a **Character Info** panel on the right. The scene
holds the place title, translucent room-chatter panel and centered character
lineup, with no redundant "Room Occupants" heading. Occupants stand left to right
as borderless, layered sprites with dark nameplates underneath. Click a sprite
or name to select them; only the sprite has the existing cyan bottom highlight
and soft glow (no second highlight around the occupant), while the selected
nameplate has a cyan edge. Other sprites are slightly muted. The cage entry is
smaller than a standing character. Crowds scroll horizontally, keeping the
selected person visible. The room stage has a 300px minimum height; the lineup
fills the available height and bottom-aligns its occupants.
The details column is at most 400px wide, with a face
portrait and the existing character facts, meters and clothing; below 760px it
sits under the scene. The **Character Info** heading is not a nonfunctional tab.
The portrait and summary use a top-aligned two-column header. Body size appears
beside the selected character's race, using the same labels and unusual-size
highlight as the player panel. Favor/Trust and
Children/Fertility form paired rows, with the meters and clothing below.
When no relationship, Hate Mark or mood tags, sleep or anger states need the
space, the existing `nameArray[NO][na_Title]` title appears as a short blurb.
Decorative title delimiters and appended race/ability fields are omitted. Missing
titles stay absent; longer scripted biographies are not executed on redraw.
An empty room shows one centered "Nobody else is here" message and a movement
hint, not a second "Just you" entry. A visible cage entry is not treated as empty.
Portrait hover expressions, effect layers, time-stop fading and the game's
image settings are preserved. The target's Palam remains below the room card.

The room stage uses a neutral gradient with no background illustration.
The main-screen cards use dark navy backgrounds, thin cyan borders and compact
corners; action groups have cyan headings and larger rectangular controls.
Whitespace-only text spans are hidden within action groups so legacy printed
spacers do not take up empty option slots.
The action toggles are right-aligned, following the title's divider line.
Go & Manage omits Change Partner [802], since clicking a person in the lineup
selects the same target; entering 802 still opens the game's original picker.
The player and interaction panels have bottom-right seasonal flower decorations
from `web/decoration/deco_corner_flower_<season>.png` at 14% opacity, selected
from the header's current game season. The artwork sits behind the content and
does not intercept clicks; the room scene and dense stats panel stay undecorated.
These styles are scoped to the main screen, leaving dialogs and other menus
unchanged.

To iterate on the main screen, use the conformance demo's item 8 (Menu → Conformance demo, then `8`): it initializes the game's talent maps and starts the
game with the hotpatches already on its main screen, alone, with one, two or six people, with time stopped (alone or
with company), with a sleeping partner, exhausted, or outdoors at night in the rain; scenario 10 stays on the sleep menu
(before waking) instead. Scenario 11 stress-tests the horizontal lineup with 24
people and initially selects the last person to exercise automatic scrolling.
Scroll sideways and select someone near either end to check crowd navigation.
Restart the demo to pick another scenario.

### Area pictures

The main screen's header (and the sleep menu's) shows a panorama of the area you are in, as three pixel-art pictures
per area, season and day/night: a left end, a middle that repeats along the header, and a right end. They live in
`web/areas/<map id>-<name>/<season>-<day|night>-<left|middle|right>.png` (the area directories are named after the
SVGs beside them, e.g. `0-shrine`, `3-mansion`; the seasons are `spring`, `summer`, `autumn`, `winter`). Import them
with

```sh
npm run area-art -- 0-shrine spring day left.png middle.png right.png
```

which takes pixel art drawn large (each art pixel a block of about 4 screen pixels; pass `--block <px>` otherwise) and
snaps it back to its own grid (one colour per block, alpha fully on or off, which also drops faint background noise),
crops the three to one height standing on their bottom edges (draw the ground along each picture's bottom), trims
the ends to their content and writes the files. Give the middle picture a width that is a multiple of the block size
and that tiles seamlessly; the ends are drawn over it, so they may fade out into transparency where they meet it.

The browser shows them at one art pixel per CSS pixel, scaled nearest-neighbour (`image-rendering: pixelated`), and
the header grows to their height. Dawn and night use the `night` pictures, or the `day` ones dimmed when there are
none; an evening dims the day pictures slightly. An area or season with no pictures falls back to its SVG landmark.
The server lists the files at `/api/areas`; the client reads that list once per page load.

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
