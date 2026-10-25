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
| `MAIN_SCREEN.ERB` | `@SHOW_STATUS` | The main screen as panels (`era-main` layout). A header whose backdrop is the sky for the hour, weather and season (`HOTPATCH_SKY`: CSS gradients, clouds, rain/snow, hills; dimmer under a roof, none underground) with the area's landmark in front (`HOTPATCH_AREA`, the map the place is on; one SVG per area in `web/areas/`, drawn blocky through the `era-pixelate` SVG filter in `web/index.html` so it matches the pixel font, e.g. the torii and hall for Hakurei Shrine, bamboo for the Bamboo Forest, the clock tower for the Scarlet Devil Mansion) with the clock (at night a dark dial with radium-green numbers and hands, through the `era-radium` SVG filter in `web/index.html`), the date on a translucent panel and a large **Time Stop** / **Resume Time** button with the TSP gauge built in; the room occupants as a tab rail joined to the character card (portrait, name and favour; click to make them the target; the selected tab opens into the card, which is shown as one box with the rail; separate cards when stacked on narrow screens) with the target's Palam below; a card titled with the place (name with its area after it in grey, e.g. "Player's Back Room Hakurei Shrine", furniture, cleanliness) and the room's chatter under it (others' talk, the radio, room descriptions), then the target's portrait, name, favour/trust/children/fertility, anger and sleep state, and Sta/Ene/Mood/Composure meters, then the look text (clothes and what is happening to them; LOOK_AT without its picture and toggles) (or, when nobody else is there, a placeholder with a hint, matched by a "Just you" entry in the list; each row of cards shares one height); a player card with your funds in its title (charisma and bullet money in the tooltip), Stamina/Energy/Vigor meters, a plain "Status:" line (arousal Soft/Hard/Erection!!, hunger and bath such as "Can eat", "Can bathe", sleepiness, and your body stains such as "Hands: Semen", from STAIN_INFO; the target's stains are on a "Stains:" line in their card), the Pushdown Guard toggle (with an explanation) and special states. The game logic before the display (target refresh, events) is kept verbatim. |
| `MAIN_SCREEN_COMMANDS.ERB` | `@SHOW_USERCOM` | The commands as chips grouped under "Interact with *target*" (Talk & Touch, Advances, Activities, Outing, More and the situational "While time is stopped" group) with the command filters as toggles colour-matched to their commands (petting pink, chores green, dialogue blue), each shown only when flipping it would change the listed actions (it tries each flag and restores it) and a ★ Stalk button (follow the target, only with a target), and a "Go & Manage" card for movement, management and settings, starting with "Look after yourself" (Have a Meal and Relax in the Bath, taken out of Activities; Dirtiness/Body Stains [801] is dropped, as the stains are shown on the cards); the condom/moan/standing settings only during a session, mischief, free use or stopped time. Closes the `era-main` layout. While time is stopped the whole screen freezes: frosted cards, desaturated meters (portraits stay in colour), an iced clock. The Petting toggle's tooltip notes that the game shows petting actions anyway while time is stopped, except Fingering and Anal Caress, which keep following it. The show/hide toggles for the status and commands (3001–3003), the Display Image / Display Settings options and the line padding are dropped. |
| `MAIN_SCREEN_LOOK.ERB` | — | `HOTPATCH_SCENE` and `HOTPATCH_LOOK` split `@LOOK_AT` for the main screen: the room's chatter (ANOTHERTARGET_TALK, 情景描写) goes under the place title, and a verbatim copy of the clothes part goes in the character card, without the [Look] toggle, Display Image/Settings, the picture and the blank padding. `@LOOK_AT` itself is unchanged for its other callers. |
| `SLEEP_MENU.ERB` | `@SHOW_SHOP` | The menu shown while you sleep, before waking, as panels in the main screen's style (`era-shop` layout): the header (sky, area landmark, a clock showing the waking time, the date, "Waking at" with Change [2400] and Calendar [3333] chips, and a large **Wake Up** [100] button); your card (funds, Sta/Ene/Vig/TSP meters, "Fainted"); a Home card (home and area, where you are sleeping if elsewhere, Home Settings [102] and Change Home [120]); "Records & Collections" and "System" cards with the menu grouped (You, Collections; Settings, Guides, Game); the tip at the bottom. Command numbers, the 4-hour minimum sleep check and the greying while fainted are the original's; USERSHOP is unchanged. The DRAWLINE rules and spacing lines are dropped. |

To iterate on the main screen, use the conformance demo's item 8 (Menu → Conformance demo, then `8`): it starts the
game with the hotpatches already on its main screen, alone, with one, two or six people, with time stopped (alone or
with company), with a sleeping partner, exhausted, or outdoors at night in the rain; scenario 10 stays on the sleep menu
(before waking) instead. Restart the demo to pick another scenario.
