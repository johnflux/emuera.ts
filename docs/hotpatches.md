# Hotpatches

Hotpatches redesign parts of the game's screen for the browser without editing
the game folder. They are ERB files in [`hotpatch/`](../hotpatch) that are read
after the game loads (`applyHotpatches` in [`src/loader.ts`](../src/loader.ts)).
Unlike [game patches](game-patches.md), which fix genuine bugs in the game, a
hotpatch only changes presentation. The one exception is
`INTIMACY_COMMANDS.ERB` (see the table below), a deliberate gameplay change.

## Rules

- Each `@FUNCTION` in a hotpatch file **replaces** the game's function of the
  same name, including every overload or event variant of it.
- New helper functions must be named `HOTPATCH_*`. Any other name that the game
  does not define is an error, so a typo cannot silently create a dead function.
- Replaced routines remain callable as `HOTPATCH_ORIGINAL_<NAME>`, allowing a
  presentation wrapper to reuse the game's editors and initialization logic.
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

The main-screen and wake-up clocks use a crisp, minimalist vector dial instead
of the game's five-minute sprite frames. The minute hand shows the exact game
minute and the hour hand advances between hours. The approximately 123 px dial has
warm ivory enamel, serif Arabic numerals, a fine 60-mark minute track, concentric
engraved rings and tapered bronze hands. Minute marks are longer and heavier, with all twelve hour marks
emphasized and the four quarter-hour marks strongest. The artwork's translucent
insets supply the textured glass sheen over the live dial and enamel backgrounds,
replacing the separate CSS glaze.
The clock retains its dark brown and gold night
palette and an icy time-stop
palette. Its tooltip and accessible name give the 24-hour time; the wake-up
clock uses `TIME:3`, while the main clock uses `TIME`. Neither runs in real time.
The supplied combined gold pocket-watch and plaque artwork is bundled unchanged as
[`web/clock-frame.png`](../web/clock-frame.png) (825 × 509 px).
The aligned hover artwork is [`web/clock-frame-hover.png`](../web/clock-frame-hover.png).
Both cleaned-up assets are bundled unchanged, preserving their supplied
transparency and subtle inset texture without additional opacity processing.
Mouse hover and keyboard focus on an enabled control fade the additive hover
layer above the normal artwork over 220 ms; leaving fades it back out.
The toolbar overhang mirrors the current layer opacity throughout the fade.
Reduced-motion preferences disable the fade.
The complete artwork scales proportionally in a responsive 420 × 259 px footprint.
The live dial and enamel backgrounds sit behind the transparent insets; button
text and the TSP gauge remain above the sheen.
The watch sits beside the header's time control, with its crown extending above
the scenic panel. The sky remains clipped to the panel's rounded corners.
The dial's oval is fitted to the hover asset's inset: center
(243.45, 288.30), radii 120.15 / 122.49 px, minor axis at 20.71 degrees.
A measured affine transform fits the bezel while retaining an 8-degree
rotation of the numerals and hands.
The crown can also draw over the app toolbar: a non-interactive, accessibility-
hidden frame overlay repeats only the part clipped above the terminal viewport.
It follows scrolling, resizing and frost transitions, disappears when the scenic
header scrolls away, and stays hidden while the toolbar menu or a game dialog is
open. The terminal itself keeps its normal clipping and scrolling.
The watch and Wake Up / Time Stop / Resume control share an `era-watch-control`
group so they stay together when the header wraps. The artwork supplies the
ornate frame, chain and existing watch/plaque overlap; no separate CSS rim is
painted. The real button occupies the plaque inset with pale lettering.
A non-interactive layer behind the plaque provides dark teal Time Stop,
warm brown Wake Up and violet Resume enamel; the metal conceals its edges.
The former plaque mask is no longer needed. Unavailable controls use charcoal
and muted text.
The watch has a -60 px right margin and retains its -44 px top margin.
A -16 px bottom margin restores the shorter header footprint without resizing
the artwork or clipping its overflow.
With area artwork, the scenic header instead has a fixed height of the artwork
height plus 2 px. The watch/control is absolutely positioned at top -32 px and
right -37 px with a 300 px width and no reserved right gutter. The scenic
control retains the full 1.15em label size and shifts its text, gauge and hitbox
6 px left to center them within the plaque. The active scenic
main/shop screen disables horizontal terminal scrolling while retaining vertical
scrolling; other screens keep their existing overflow behavior. Long date/location
text can scroll within its panel rather than stretching the header.
The plaque's enlarged hitbox spans 37.5% of
the artwork width and 31% of its height; labels use 1.15em text. Hovering or
keyboard-focusing an enabled control brightens its enamel background as well
as fading in the hover artwork.
The button's transparent `::before` hit area extends 8 px above and below its
visual bounds. Adjust the first value in `inset: -8px 0` to change that extension
without moving the text or gauge.
The TSP gauge and all original command numbers and availability rules remain intact.
Decorative layers ignore pointer input, and keyboard focus has
an explicit outline. Resume uses frosted metal and violet lettering, a single
heading with no subtitle, and the existing TSP gauge. Its tooltip describes
resuming time and notes when time was stopped while teasing.
Only the dial changes palette at night; stopped time also frosts the bronze.
The browser renders `<div class='era-clock' data-minutes='…'>` as this dial,
accepting only safe integer minutes; game HTML cannot supply arbitrary SVG.

The eraTW main-screen character card uses adjoining Character Info and Interaction
History tabs; history can expand into a read-only dialog showing the full timeline.
Serve Alcohol (332) is omitted when the inventory has no selectable alcohol,
using the same valid-drink list and `IS_ALC` rule as the game's alcohol menu.
Action filters and matching actions share category tints: vaginal light pink, anal
light brown, SM red, service/reverse service light yellow, petting muted pink,
housekeeping green and dialogue blue. Overlapping command tags prefer vaginal
or anal, then SM, then service, before the everyday categories.
Enabled vaginal and service toggles use pastel fills with dark text to keep them
distinct from the brown and red toggles, including while time is stopped.
The stats panel keeps its existing width: meter tracks flex around the actual
numeric values and projected gem gains rather than reserving fixed-width slots.

[`TIME_EFFECTS.ERB`](../hotpatch/TIME_EFFECTS.ERB) lets the GUI animation announce
time freezing and resuming without the generic narration or an extra click.
`TRAIN_MESSAGE` skips only the freeze command's separator, message and `PRINTW`;
its state bookkeeping, equipment effects and counter reactions remain intact.
The `LS_RESTRICTION` wrapper returns true only for `"Resume time print"` to skip
the resume routine's announcement and `PRINTFORMW`, delegating every other query
and its arguments to the original routine. Resume warnings, aftereffects and
character dialogue are not suppressed.
The eraTW runtime also omits the interpreter's default end-of-command wait for
command 355 when this hotpatch is loaded; other commands retain that fallback.
The freeze wrapper restores the default output background after executing the
original command, replacing its flat blue backdrop with the animated GUI frost.
Its source-check dashed separator is omitted from delivered output without
changing source processing or the interpreter's logical line count.
The main-screen redraw also keeps the default background while frozen instead
of reapplying the legacy blue tint.
Frozen scene filters and portrait fading ease in and out over 900 ms, while
restoring a run and reduced-motion mode apply them immediately. The main-screen
last-command label is now the command input's placeholder rather than an extra
output line; its game-computed name (including training and assistant labels)
is preserved without putting hint text into the submitted input.
Action-group headers reserve at least 22 px even when no filter buttons are
visible, and center their contents vertically rather than sharing a baseline
with filter buttons, so the title stays in place as filters disappear.
The reserved height also covers one text line plus the buttons' 6 px vertical
padding, accounting for font-size changes and fractional font metrics.
They can still grow to accommodate wrapped filters on narrow screens.
The terminal hides its horizontal scrollbar in Chromium/Electron and Safari
without disabling horizontal scrolling. Trackpad gestures and Shift+wheel can
still reach overflow content; the vertical scrollbar and configured logical
width remain unchanged. Browsers without WebKit scrollbar styling retain their
normal scrollbar.

The eraTW launch screen retains the original TW title artwork with responsive
sizing and no image filters or glow, alongside matching in-game panels. Setup fits
its content rather than reserving a full-height dialog; editors and save lists
remain scrollable within the viewport.
The wake-up menu and main screen fill the terminal's available width and height,
accounting for the terminal's 16 px top padding, and retain scrolling on smaller
screens. The Home card aligns the room and area names
beside the location pin, with spacing above the area and home controls.
Loading no longer pauses on the successful room-setup confirmation; room
initialization and failure prompts remain intact. Selecting Wake Up clears the
screen before the original wake-up flow, so the sleep menu does not linger.
The title's New Game and Load Game controls use the supplied WebP artwork in
[`web/title/`](../web/title/), retaining text labels for accessible button names.
New Game sits to the left, with Load Game beneath it offset to the right.
Pointer hover and keyboard focus brighten the original button artwork with CSS
brightness, saturation and alpha-shaped neon drop shadows (green for New Game,
purple for Load Game, with a cyan halo). Both buttons stay stationary on hover:
the glow powers on over 180 ms with an easeOutBack brightness peak, then settles;
on exit it fades over 90 ms with ease-out. Pressing scales only the artwork to
98.5% over 60 ms for tactile feedback, leaving hit areas and layout fixed.
Reduced motion switches the glow instantly and disables the press scaling.
No alternate hover images are used.
The clicked title button retains its glow while input is pending and after
selection, without the generic pending pulse, until the dialog opens.
The artwork fills a borderless, black title screen below the interpreter header, with version information at the
top-right and New Game / Load Game stacked underneath; the redundant text title
is omitted. Version and footer text are anchored outside the central composition;
artwork and buttons scale together against both available terminal dimensions as browser
zoom changes. Only the active title screen suppresses overflow.
The interpreter header remains visible and usable, showing the running game's name
(or Demo) and the debug indicator when enabled. Text input is hidden only while this title
screen is active; dialogs and gameplay retain their normal controls.
Load Game opens a wider, content-sized slot picker (including autosave), with
compact full-width rows to avoid wrapping and fit a page without scrolling on
desktop. Empty and occupied slots have matching padding, margins and single-line
heights. Descriptions can still wrap and increase a row's height when needed;
scrolling remains available when the viewport cannot fit all rows. It
cannot accidentally switch into saving over an existing game from the title.
New Game initializes the standard custom character and Hakurei Shrine residence,
then opens a larger, viewport-bounded setup dialog with Player, Characters, World, Bonuses,
Farming, Dialogue and Yandere tabs. Clothing, the six native penis-type choices
(when applicable), residence presets, all starting
bonuses with descriptions, bonus partners, farming contracts/difficulty,
confession mode, Lunatic Survival, dialogue variants and common yandere settings
are selectable directly as compact list rows with selection markers, names and
descriptions, with the current choices highlighted. Settings changes preserve
the current tab's scroll position; switching tabs starts at the top.
Player contains the player's customization, clothing and penis settings;
Characters contains the body editor for other characters.
Player has a portrait (or a neutral silhouette), inline name/nickname text fields and
native stamina/energy steppers. Its Clothing, Body, Appearance & traits, Abilities and
Experience sections edit native values directly, reusing customization eligibility,
cycling and validation rules. Direct experience entry uses a focused
prompt rather than the full customization menu. Name fields commit together on
Enter, leaving the fields, or the next setup action, including Start Game.
STA, ENE, abilities, experience and Yandere percentages share a numeric control:
minus/plus buttons without tooltips and a centered, directly editable value.
The value has a muted cyan underline, at least 3ch wide (4ch for STA/ENE),
which brightens and thickens on hover or focus without shifting the layout.
Ability groups are 17ch wide within 110ch; experience groups are 26ch within
118ch, with a minimum 10ch column gap. The short experience translation uses
"Train Masturb Exp"; the full translation is unchanged.
The Sensitivity & Response tab (formerly Abilities) explains starting sensitivity
and responses. It and Experience share the Traits-style details sidebar, updated
on item hover or keyboard focus, including focus within numeric controls.
All three tabs use matching muted item labels without dashed tooltip underlines.
Browser fields select on focus and commit on Enter, blur, or the next setup
action, validating each setting's native range (experience remains 0–30).
STA displays its native 500-point offset; its buttons and ENE still step by 100.
The native direct-entry prompt remains available to non-browser clients.
Name fields grow beyond 16ch with their contents. The predefined-character
button sits beside the nickname, and the compact stats row keeps labels close
to values. Player sub-tabs retain the same header spacing across sections.
An identical name/nickname displays as an empty nickname with the name as its
live placeholder; saving an empty nickname uses the current name.
Predefined players have a Custom Character button that resets the player to
custom defaults, restores the original character's availability, and retains
the selected residence and other world settings.
Characters embeds the body editor's main menu directly, correcting Individual
Settings and omitting the native Finished entry. Bulk choices apply immediately;
individual, pregnancy and randomization submenus retain their native editors.
After a bulk action, a visible confirmation names the applied operation.
These are immediate actions rather than on/off toggles; the confirmation
records the last operation, not a persistent selected preset.
The predefined-character picker is a scrollable, unpaged portrait list with
one name, sex, race, figure and STA/ENE bars (no age or TSP). A browser-generated search field
filters the list locally. Cancel returns to setup without changing the player;
selection retains native character-copy and follow-up customization behavior.
Shared STA/ENE bars use a fixed 2000-point scale, with unavailable capacity
greyed out. Capacity above 2000 appears on a second thin bar; that overflow
bar uses another 2000-point scale, expanding only for capacity beyond 4000.
Numeric values and low-resource warnings still use the character's actual
current and maximum values. Vigor and Composure use the same capacity and overflow treatment on a
1000-point scale. Composure retains its low-state warning and LimitBreak label.
Other resource bars retain their native scales.
Setup cards have no inner padding. The footer contains Start Game; the header
close button still returns to the title.
All setup tabs use title-case headings, transparent borderless sections, compact
choice rows without horizontal dividers, and consistent choice indentation.
Desktop choice lists size their label column to its contents (capped for long
labels) and keep the same description gap as Body. Yandere percentage controls
stay beside their labels rather than stretching across the dialog.
The player portrait has no border.
World shares one label column across sections so help text and radio labels
align. Home details, supporting Lunatic Survival text and Map Display controls
are indented to the radio circles; Detailed rules follows the survival help
inline. Dialogue also shares a label column across characters so all help
text aligns. Non-choice content spans the shared grid rather than occupying
an individual radio or label column.
Traits use compact text entries without hover recolouring. Native descriptions
appear in a scrollable side panel on hover or focus (above the list on narrow
screens), rather than covering the choices. The smaller-text panel is at most
270px wide and fills the trait list's height without growing with its contents.
The compact trait grid fits more columns on wide screens.
The setup dialog expands to 1600px (within the viewport). Trait columns use
2px gutters and a wider minimum cell so labels avoid unnecessary wrapping.
Body groups sex, breast and butt sizes, race categories, and conditional penis
settings as individual selectable rows rather than cycling controls.
Body and Clothing sections have no card background.
Their choice rows have no bottom divider and use 2px vertical padding, with
tighter heading spacing and extra space below each section. Body precedes Clothing.
Section bottom padding is 2px. Body options scroll independently, leaving the
player header and sub-tabs visible; editing a Body choice preserves its scroll.
Body opens by default. On desktop, all Body sections share a content-sized
option-name column so descriptions align across sections. Clothing sizes its
own name column to its contents.
Age is selected in Body using the native Child, Adult, Middle Age and Elder
categories, rather than cycling it in Appearance & traits. Age choices show
labels only, without descriptions.
The tab is now named Traits. Figure, Cat Tongue and Animal Ears use individual
choices in Body. Figure retains all seven native sizes, with its normal size labeled Adult,
with a short, size-specific description for each. Shared Figure help retains
the native Forbidden Knowledge restriction and insertion difficulty from size
differences; the Inchling row also explains its native parameter effects and
additional use.
The None choices for Cat Tongue and Animal Ears have no help text; other ear
choices use a short description, and Futanari uses "Has both genitals."
Kitsune and Youko belong to Race and require New Game+ like the other
race selections, including when invoked through legacy setup actions.
Body has one Race selector and one New Game+ notice. Choosing a race replaces
the other selectable racial traits; only selected races expose sub-options.
While locked, the Race section shows only the unlock notice, with all race
choices and sub-options hidden.
The unlock notice is muted and aligned with the choice circles.
Breast sizes are hidden for male players and have short size-specific
descriptions. Butt sizes have labels only, without repetitive help text.
All eight native butt-size states
have visible names; the native cycle and saved values are unchanged.
Race changes retain the native New Game+ restriction, explained in Body.
The player header includes race, sex and figure (Adult for the normal size).
Native sex cycling is Female, Male,
Futanari; it does not offer a sexless player.
Abilities and experience use tightly spaced numeric steppers with fixed
two-character value cells and wider gaps between entries.
Controls align vertically within each column regardless of label length.
Numeric groups have fixed widths (19ch for abilities, 29ch for experience),
with extra container space distributed between groups rather than within them.
The portrait sprite keeps its natural aspect ratio. Name fields use subtle
underlines, with the primary name styled as the heading instead of a Player label.
Changing sections resets scroll;
editing values in a section preserves it.
Clothing starts with Default, following the native predefined-character outfit
or men's/women's clothing rule. While Default is selected it follows gender
changes; explicitly chosen outfits are preserved.
Farming groups the no-contract option with landlord choices. Contract terms stay
visible but disabled without a landlord. A reserved summary area explains daily
field work, monthly harvest collection and rewards, updating with the chosen
landlord's crop, location and starting loan.
The selected landlord's native face portrait floats beside the summary, with
landlord and loan details above the farming description.
The description names the field-work command's actual map location (including
travel-map replacements outside the home region), not the flavour name of the
plot. The landlord list shows the player's home region and bolds matching farm
regions with a Home region label, updating when the residence changes.
The Your home region indicator is right-aligned in the contract list heading;
crop, work location and region are bold in the selected contract description.
Emphasized setup details also use brighter text and a slight stroke reinforcement
so they remain distinct with the bundled regular-only font.
Farming difficulty descriptions show monthly interest rates: Hardcore divides
the native rate by 12; Extreme uses the native rate directly. Rates display to
two significant figures in bold, with no emphasis on the shared monthly period.
The underlying debt calculations are unchanged.
Normal requires buying tools; the harder modes lend
tools with monthly fees.
Romance settings separate the mode (normal, restricted player actions, or
unrestricted Lust mode) from other characters' increased assertiveness.
Assertiveness appears only for the two enhanced modes and is preserved when
switching between them. Returning to normal clears the increase.
The pregnancy-stage restriction is a separate, default-off override.
Map display animation defaults to on. Dialogue descriptions convert literal
`<br>` to line breaks, leaving other markup escaped as plain text.
Bonuses are still applied exactly once by the native bonus routine on Start Game; farming uses the
native debt, difficulty and tool rules. Residence presets initialize the native
rooms, owners, residents, sleep and traps. The detailed map/room picker, full
character/body editors and yandere character-potential editor remain available
inside the enlarged dialog. Start Game accepts the defaults without visiting any
tab. Dialogue still uses the game's own reset/update routines and can be changed
later through the game's character update settings. No save layout or variable
reservations are changed. Other games keep their own start flows.
Setup is prepared before `BEGIN FIRST`, so Cancel does not run first-start
events or create an autosave; `NEWGAME` completes initialization after acceptance.

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

The browser adds the selected character's latest 20 recorded interactions below
the main action groups, separate from Character Info. Inspecting this history
does not advance the game. Main-screen output supplies the selected history
metadata without printing a placeholder in Character Info. See
[character interaction history](developer-guide.md#eratw-character-interaction-history)
for the initial command coverage, capture semantics, and save checkpoints.

On the main screen, **See more** beside the character's name opens the same room-wide
character sheet as the player's **See more**, but starts on the selected
character without changing the target. `CHARA_SHEET.ERB` also replaces
`@Add_Custom_USERCOM` to handle this presentation-only entry [-9300]; its other
custom-command handling is unchanged. `@TARGET_LIST_STATE` accepts an optional
character to focus and still defaults to the player. The player panel's Inventory
uses a softly bordered control. Pushdown Guard is a rectangular management
control on the player card, like Auto-Clean, with its explanation and pressed state.
Standing explains the preference for supported standing positions (and the
location fallback); Auto-moan explains its three per-character modes and scripted
dialogue fallback. Time Stop keeps its translucent background and
adds a 3px backdrop blur.

`PLAYER_SPECIAL.ERB` supplies main-screen-only helpers for special effects and
ejaculation/milk gauges. Active effects are small wrapping badges; the empty
Special label is omitted. Gauges use responsive meters, compact current/maximum
values, character captions, and clickable Normal/Quick/Endure mode pills with
endurance levels. Imminent warnings remain visible. Original gauge initialization
and repair side effects are preserved; other screens still use the game's
original printers.

The sheet heading combines "Character sheet" and the character tabs on one row,
with the viewed character highlighted; only the player's active tab says "You".
Previous/next arrows [77]/[88] remain available
for every multi-character list, including short lists with individual tabs.

| File | Replaces | Change |
|------|----------|--------|
| `ITEM_LIST.ERB` | `@QoL_AllItemSort` (called by `@SHOW_ALLITEM`) | Inventory [805] opens in the same modal system as the character sheet, with category tabs and a compact, responsive list of item names and quantities. Hover or focus an item for its description. A search box inside the footer filters names instantly, case-insensitively and entirely client-side, with a matching-item count and an explicit empty state. The filter persists across category and item-mod views until the dialog closes; clear the textbox to reset it, or select All to search every category. The browser creates the textbox in an `era-inventory-filter` placeholder, without expanding the game HTML allowlist. Return, Escape and backdrop clicks close it; category IDs [3000–3020], Item mods [777], Back to items [889] and Return [999] remain available. The Inventory button is on the player card, retaining the existing command-filter bit 4 visibility rule. |
| `INTIMACY_COMMANDS.ERB` | `@COM_ABLE312` (Kiss), `@COM_ABLE352` (Confess), `@COM350` (Push Down) | **Gameplay change.** The originals with the closeness (`TCVAR:MASTER:馴れ合い`) gate removed, so the player can try a kiss or a confession without small talk first; the commands' own consent checks then decide, and a rejection applies the game's usual penalties (antipathy, anger, hate marks). The other gates (sleep, work, the kiss cooldown, stamina, one confession a day, spineless) are kept. Used by the LLM chat's `player_attempts`; typing 312 or 352 works too, and the buttons show under the Petting filter. Push Down with others in the room (a group attempt, as the target list is everyone present) asks each person who has not consented before for their own answer first: a refusal plays out with its reaction and penalties and ends the attempt, and only if nobody refuses does the group's objection ("some of them still oppose the idea of having an orgy") stop it. Originally the group check came first, so the person never reacted. |
| `INFO_PALAM.ERB` | `@SHOW_INFO_PALAM` | Palam as a wrapping grid: short name, level, meter, value against the next level's threshold (`1234/2500`, abbreviated as `23.4k/30.0k`) and gain. Zero values are dimmed and the highlighted Palams use the game's yellow. The tooltip shows the full name, a short description of what the Palam is (`HOTPATCH_PALAM_ABOUT`), value, level, "Next level at …" and gems. The collapse toggle and the bars/numbers toggle are dropped. |
| `MAIN_SCREEN.ERB` | `@SHOW_STATUS` | The main screen as panels (`era-main` layout). A header whose backdrop is the sky for the hour, weather and season (`HOTPATCH_SKY`: CSS gradients, clouds, rain/snow, hills; location-specific cavern ambience for the Underworld) with the area in front (`HOTPATCH_AREA`, the map the place is on): a pixel-art panorama for the season and time of day where there is one (see [Area pictures](#area-pictures)), otherwise one SVG landmark per area in `web/areas/`, drawn blocky through the `era-pixelate` SVG filter in `web/index.html` so it matches the pixel font, e.g. the torii and hall for Hakurei Shrine, bamboo for the Bamboo Forest, the clock tower for the Scarlet Devil Mansion) with a minimalist vector clock (exact-minute hands, teal accent; a dark luminous dial at night), the date on a translucent panel and a large **Time Stop** / **Resume Time** button with the TSP gauge built in; a room card titled with the place (name with its area after it in grey, e.g. "Player's Back Room Hakurei Shrine", furniture, cleanliness) and the room's chatter under it (others' talk, the radio, room descriptions). The occupants stand left to right as borderless sprites beside the selected character's details (at most 400px wide), with the target's Palam in the right sidebar. Each occupant has their name in the game's mood colours (blue asleep, pink in heat, orange drunk, aqua happy, red sullen), favour and state, followed by relationship, Hate Mark and Mad/Sad/Sullen/Happy tags when applicable (`HOTPATCH_FEELINGS`, in the character list's words and colours). Click a sprite or name to select them; a bottom highlight and glow mark the selected person. Portrait layers stack in one place, preserving the game's hover expression and fading the time-stop tint rather than showing its flat square. The selected character's details show their name (card-title blue unless the game colours it for their mood), species (`PRINT_GET_RACE`, with `RACE_INFO` on hover), favour/trust/children/fertility and feelings, anger when nonzero, sleep state, Sta/Ene/Mood/Composure meters and look text (clothes and what is happening to them; LOOK_AT without its picture and toggles). When nobody else is there, a single placeholder and movement hint fill the room stage; each row of cards shares one height. A player card has a "See more" button [803] (the character sheet, below) and your funds in its title (charisma and bullet money in the tooltip), your race and body size on a small grey line under it (`HOTPATCH_PLAYER_KIND`: the sheet's race talents, e.g. "Human", and the size talent, "Normal size" when there is none, highlighted otherwise, e.g. "Inchling" after the mallet), Stamina/Energy/Vigor meters, a plain "Status:" line (arousal Soft/Hard/Erection!!, hunger and bath such as "Can eat", "Can bathe", sleepiness, and your body stains such as "Hands: Semen", from STAIN_INFO; the target's stains are on a "Stains:" line in their card), compact special-effect badges and responsive gauges (`PLAYER_SPECIAL.ERB`). Management controls, including Pushdown Guard, are merged into Player. The game logic before the display (target refresh, events) is kept verbatim. |
| `MAIN_SCREEN_COMMANDS.ERB` | `@SHOW_USERCOM` | The commands as chips grouped under "Interact with *target*" (Talk & Touch, Advances, Activities, Outing, More and the situational "While time is stopped" group) with the command filters as toggles colour-matched to their commands (petting pink, chores green, dialogue blue), each shown only when flipping it would change the listed actions (it tries each flag and restores it) and a ★ Stalk button (follow the target, only with a target), and movement, management and settings controls merged into Player, starting with "Look after yourself" (Have a Meal and Relax in the Bath, taken out of Activities; Dirtiness/Body Stains [801] is dropped, as the stains are shown on the cards; Abilities [803] and Abilities (Master) [804] are dropped for the player card's "See more", though both numbers still work); the condom/moan/standing settings only during a session, mischief, free use or stopped time. Closes the `era-main` layout. While time is stopped the whole screen freezes: frosted cards, desaturated meters (portraits stay in colour, faded by the game's time-stop tint layer), an iced clock. Each toggle's tooltip is one line saying what it shows, e.g. "Petting: Show touching actions she may not welcome (pink)" (the chip is lit when on). The show/hide toggles for the status and commands (3001–3003), the Display Image / Display Settings options and the line padding are dropped. |
| `MAIN_SCREEN_LOOK.ERB` | — | `HOTPATCH_SCENE` and `HOTPATCH_LOOK` split `@LOOK_AT` for the main screen: the room's chatter (ANOTHERTARGET_TALK, 情景描写) goes under the place title, and a verbatim copy of the clothes part goes in the character card, without the [Look] toggle, Display Image/Settings, the picture and the blank padding. `@LOOK_AT` itself is unchanged for its other callers. |
| `CHARA_SHEET.ERB` | `@SINGLE_CHARA_STATE_TR`, `@LIST_CHARA_STATE_TR`, `@TARGET_LIST_STATE`, `@BASIC_STATE`, `@SHOW_FALL_STATE_REV_REQUIREMENTS_TR`, `@CHARA_STATE_TR`, `@PRINT_ABL_MOD` | The character status screens (Abilities [803]/[804] and "See more" on the main screen, Abilities [101] on the sleep menu, and the other callers) as an `era-dialog` popup. Its header has the people as tabs (you first, then the room's occupants, each switched with one click) or, for long lists such as the sleep menu's whole roster, ‹ › arrows around the name and "3 / 165", plus a × close button; then the pages as tabs (Clothes & Abilities, Exp & Gems, Personal Info, Preferences, Body, Falling Conditions, or Skill Acquisition for you, and Character Settings where the game offers it). The game's `CHARA_STATE_TR` page scrolls in the body, and the Choose/Return buttons of the final check before starting stay in a footer. The input loops are the original's. `@TARGET_LIST_STATE` opens on you rather than on the target. `@BASIC_STATE`, the top of every page, is verbatim except for the Sta/Ene/Drunk/Vig/TSP bars, which the game prints with uneven spacing: they are the main screen's meters in a two-column grid, with value / maximum (aqua when buffed, yellow when debuffed, as in the game); the heavy rule it opens with is hidden in the dialog, under the header's border. `@SHOW_FALL_STATE_REV_REQUIREMENTS_TR` (Falling Conditions / Skill Acquisition) prints its page buttons (Body Parts, Skill Acquisition, …, [3500 + n]) as sub-tabs above the list instead of a row under it. `@CHARA_STATE_TR` and `@PRINT_ABL_MOD` (only the sheet calls them) tidy the Clothes & Abilities page: "Unmeasured" and the Abilities table get the Clothing labels' indent, and Personality the blank line above it that the other sections have (its rows stay one column further left, in `PRINT_STATE_TALENT_TR`). |
| `ROOMSETTING.ERB` | `@ROOMSETTING` | Original room initialization without the successful confirmation's wait. Failure prompts and home selection remain unchanged. |
| `SLEEP_MENU.ERB` | `@SHOW_SHOP`, `@USERSHOP` | The menu shown while you sleep, before waking, as panels in the main screen's style (`era-shop` layout): the header (sky, area landmark, a clock showing the waking time, the date, "Waking at" with Change [2400] and Calendar [3333] chips, and a large **Wake Up** [100] button); your card (funds, Sta/Ene/Vig/TSP meters, "Fainted"); a Home card (home and area, where you are sleeping if elsewhere, Home Settings [102] and Change Home [120]); "Records & Collections" and "System" cards with the menu grouped (You, Collections; Settings, Guides, Game); the tip at the bottom. Command numbers, the 4-hour minimum sleep check and the greying while fainted are the original's. USERSHOP clears the screen for Wake Up [100], then delegates every command to the original. The DRAWLINE rules and spacing lines are dropped. |
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
holds the place title, overlaid room-chatter panel and centered character
lineup, with no redundant "Room Occupants" heading. Occupants stand left to right
as borderless, layered sprites with names and status text overlaid at their feet,
without nameplate borders or backgrounds. Favor, requests and other useful status
text remain visible without adding height below the images. Click a sprite
or name to select them; only the sprite has the existing cyan bottom highlight
and soft glow (no second highlight around the occupant), while the selected
name is tinted blue. Other sprites are slightly muted. The cage entry is
smaller than a standing character, with its picture above (not behind) its text.
Crowds scroll horizontally, keeping the selected person visible. The lineup
stays exactly 216px high, including when empty, and bottom-aligns its occupants.
The room stage stretches to match the Character Info column without reserving
an additional minimum height; any spare space goes above the bottom-aligned
lineup.
Room chatter is absolutely positioned near the top of the scene so it does not
push the sprites down or intercept clicks.
The details column is at most 400px wide, with a face
portrait and the existing character facts, meters and clothing; at narrower widths
it sits under the scene. There is no tab heading; **See more** sits to the right
of the character's name and uses the same borderless text style as the player's.
The portrait and summary use a top-aligned two-column header. The face frame
remains 76px square, with its picture scaled up 10% from the bottom center so it
escapes the top of the frame. Empty status lines and extra spacing above clothing
are hidden. Clothing uses the surrounding font, sits at the bottom of the info
body, and truncates long rows with an ellipsis; hovering shows the full text.
Body size appears
beside the selected character's race, using the same labels and unusual-size
highlight as the player panel. An unlabeled size is shown as "Adult"; only the
player panel's size has the mallet tooltip. Favor/Trust and
Children/Fertility form paired rows, with the meters and clothing below.
When no relationship, Hate Mark or mood tags, sleep or anger states need the
space, the existing `nameArray[NO][na_Title]` title appears as a short blurb.
Decorative title delimiters and appended race/ability fields are omitted. Missing
titles stay absent; longer scripted biographies are not executed on redraw.
An empty room shows one centered "Nobody else is here" message and a movement
hint, not a second "Just you" entry. A visible cage entry is not treated as empty.
Portrait hover expressions, effect layers, time-stop fading and the game's
image settings are preserved. The target's Stats and Player form
one right-hand column, with Stats above Player beside the room and actions. On narrow screens
this sidebar stacks below the main content.
Stats stays at its natural content height; Player absorbs spare sidebar height,
with its controls grouped toward the bottom.

The room stage uses a neutral gradient with no background illustration.
The main-screen cards use dark navy backgrounds, thin cyan borders and compact
corners; action groups have cyan headings and larger rectangular controls.
Interaction groups wrap side by side at their natural width, without expanding
to distribute spare horizontal space.
Whitespace-only text spans are hidden within action groups so legacy printed
spacers do not take up empty option slots.
The action toggles are right-aligned, following the title's divider line.
Management controls are merged into Player, with Pushdown Guard styled like the
Auto-Clean control. Auto Items is inside Inventory and returns there when closed.
Player controls, including Inventory and Config, share the same rectangular
shape, spacing and hover/focus treatment. Inventory keeps its arrow, active
settings remain highlighted, and See more stays a borderless text link.
The management controls omit Change Partner [802], since clicking a person in the lineup
selects the same target; entering 802 still opens the game's original picker.
The player and interaction panels have bottom-right seasonal flower decorations
from `web/decoration/deco_corner_flower_<season>.png` at 14% opacity, selected
from the header's current game season. The artwork sits behind the content and
does not intercept clicks; the room scene and dense stats panel stay undecorated.
These styles are scoped to the main screen, leaving dialogs and other menus
unchanged.
Character Info has no panel border and uses reduced side and bottom padding.
When no counter panel is present, its grid row is omitted so gaps between
the main panels remain a consistent 10px.

When a character is selected, the room panel shows their
interaction history in 14px text, without dialog tabs or a separate composer.
It spans the room panel beneath the portraits and Character Info, without a
second card border. Actions remain in their own panel below the room.
A floating top-right more... button opens the full interaction history dialog.
This inline view hides only the "Narration to Player: " label, keeping the
narration itself visible. The full dialog and LLM context retain the label.
The history body has no extra padding, and the sticky more... button overlays
the top-right corner without reserving space or narrowing the text.
LLM speech and actions, including overheard
lines from other characters, never receive the game's "Narration to Player"
prefix. LLM actions instead carry an explicit actor prefix in the speaker's own
history and in witnesses' copies, so pronouns such as "she" are unambiguous in
LLM context. Older conversation actions are also attributed when the speaker is
known. The inline history scrolls to the bottom on load, new lines and layout
changes.
Each history heading fits the day/time, action, location and people on one line
(wrapping only when needed), without a collapse control. Consecutive entries
with the same day, room and people share a heading; underlying events, timestamps
and LLM context retain their individual action records.
Spoken quotation marks are displayed as 「」, including on-device translations.
Speaker names use a neutral colour rather than inheriting the script's speech
colour; the player's own lines use the existing lavender.
History reserves at least five lines of space with an internal scrollbar for
longer histories. When a character is present, history absorbs spare vertical
space while the interaction options stay at their natural height. When alone,
the actions panel fills the spare vertical space beside Player on multi-column layouts.
Absent counter rows are removed entirely so Actions and Player share
the same bottom edge when alone.
The existing command field accepts integer command numbers (including negative
menu codes) as game commands; other nonblank text goes to the selected character's
LLM. This routing applies only to the main integer-command prompt, not name,
save, single-character or other game prompts, and clicked choices remain game
input. LLM settings remain in the interpreter menu. Sending loads full history
for context; game-changing replies refresh the room after the turn. Leaving the
screen cancels any in-flight inline request. Character Info has no history tab
or conversation preview.

To iterate on the main screen, use the conformance demo's item 8 (Menu → Conformance demo, then `8`): it initializes the game's talent maps and starts the
game with the hotpatches already on its main screen, alone, with one, two or six people, with time stopped (alone or
with company), with a sleeping partner, exhausted, or outdoors at night in the rain; scenario 10 stays on the sleep menu
(before waking) instead. Scenario 11 stress-tests the horizontal lineup with 24
people and initially selects the last person to exercise automatic scrolling.
Scroll sideways and select someone near either end to check crowd navigation.
Scenario 12 meets YuugenMagan for the first time: her introduction event plays (pick her route there), and the main
screen then has her selected, so the interaction history and LLM chat can be checked against her distinctive voice.
Restart the demo to pick another scenario.

### Area pictures

Open **Artwork demo** from the game library, or visit `/art-demo`, to preview the header without starting a game.
Controls select location, season/day, exact time (or a time scrubber), and weather.
Header ambience follows the area, not whether the current room is indoors or outdoors.
The artwork selector can follow the time automatically or force day/night images independently of the sky,
including the daytime bad-weather blend. The demo uses the game's shared sky and panorama renderer and stylesheet.
It reports when a location uses an SVG fallback instead of panorama images. No game state or saves are changed.

The main screen's header (and the sleep menu's) shows a panorama of the area you are in, as three pixel-art pictures
per area, season and day/night: a left end, a middle that repeats along the header, and a right end. They live in
`web/areas/<map id>-<name>/<season>-<day|night>-<left|middle|right>.png` (the area directories are named after the
SVGs beside them, e.g. `0-shrine`, `3-mansion`; the seasons are `spring`, `summer`, `autumn`, `winter`,
or `neutral` for year-round artwork). Import them
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
none; an evening dims the day pictures slightly. When a season has no day or night panorama, the browser
uses the area's `neutral` set if present, including its matching night set for weather blending.
Season-specific sets take precedence. With neither, it falls back to its SVG landmark.
The server lists the files at `/api/areas`; the client reads that list once per page load.
The middle is clipped to the space between the end panels with a per-location overlap at each join,
rather than extending beneath the entire ends. Image widths determine the clip; narrow headers
clamp the insets to half the available width. Weather, light halos and water highlights use the
same geometry. The artwork demo's Middle/end overlap slider ranges from 0 to 600px and remembers
preview adjustments per location/season until reload; 0 puts panels edge-to-edge.
Defaults (CSS pixels): Shrine 220, Temple 88, Village 116, Mansion 320, Bamboo 264,
Forest of Magic 168, Netherworld 96, Foothills 360 and Summit 176. The demo reads the
same CSS defaults as the game; preview adjustments override them only until reload.

Hakurei Shrine includes all four daytime seasons: the original spring blossoms, green summer foliage, golden
autumn foliage, and snow-covered winter scenery. Summer uses supplied green-leaf artwork at native widths
(480px left, 481px middle, 524px right after seam cleanup), with faint alpha residue removed, transparent bottom rows
trimmed and top padding to the shared 144px height without stretching. A cut-off tree at the left panel's far end
is cropped away; the side panels taper over 64px into the backdrop, and the repeating middle has a 48px
overlapped join. Day and night use identical edge treatment. Its night grade retains warm shrine windows.
Autumn uses supplied generated artwork with
red/orange maple leaves, its white background removed before pixel-grid cleanup and resizing to 520×144px
per piece. Its matching night grade preserves geometry for weather blending and keeps the shrine windows warm.
Winter uses supplied, separately generated snow-covered artwork
for all three pieces, cleaned with the pixel-grid importer and uniformly resized to 144px tall (500px left,
501px middle/right). Its sky remains transparent and its ground is aligned across the pieces. The matching
winter night set is a cooler, darker grade of this artwork that retains the warm shrine windows.
Each season also includes a dedicated night set with cooler,
darker moonlit colors, warm shrine windows and lanterns, and brighter moonlit snow in winter. Night sets retain
the daytime geometry and transparency and are displayed without an additional night-dimming filter.

Myouren Temple includes supplied spring artwork: a pine and stone lanterns on the left,
a repeating cherry-blossom landscape, and the temple hall on the right. The three pieces are cleaned
with the pixel-grid importer, ground-aligned and uniformly resized to 571×144px. A matching cooler
night grade preserves transparency and geometry, retaining warm hall windows and lantern light.
Summer, autumn and winter use derived palette variations of the same artwork.

Human Village includes supplied spring artwork with a cherry tree and market stall on the left,
a repeating rural backdrop, and traditional shops on the right. Pixel-grid cleanup and uniform resizing
produce three ground-aligned 463×144px pieces. The matching night grade keeps shop windows and
paper lanterns warm, with identical geometry for weather blending. Other seasons use derived palette variations.

Scarlet Devil Mansion includes supplied spring artwork at its native 532×144px per piece,
with faint alpha residue removed. The gate and gardens frame a repeating lakeside backdrop and the
red-brick mansion. The aligned night grade retains warm window light and the clock face, using
the shared light halo and weather blending. Other seasons use derived palette variations.

Bamboo Forest includes supplied spring artwork, cleaned on a four-pixel source grid and resized
with nearest-neighbour sampling to 480×144px per piece. Neon green matte residue is removed before
sampling, and all pieces share a ground baseline. The left bamboo grove and right path gate frame
the repeating forest. Its cool night grade preserves transparency and geometry for weather blending;
no artificial lights are added. Other seasons use derived palettes, with olive-green autumn bamboo rather than orange leaves.

Forest of Magic includes supplied spring artwork with an ancient tree on the left, repeating
woodland in the middle and a cottage on the right. Four-pixel source-grid cleanup and nearest-neighbour
resizing produce ground-aligned 439×144px pieces with transparent sky and no neon green matte residue.
The matching night grade preserves the cottage lantern's warm light and identical geometry for
weather blending. Other seasons use derived palette variations.
The cottage panel's bottom four rows of heavy dark soil are cropped away and the panel padded
at the top, bringing its ground thickness closer to the middle. Both time-of-day sets shift together.

Netherworld uses season-neutral supplied artwork year-round: pale cherry blossoms and a stone lantern
on the left, a low repeating ornamental garden and the Hakugyokurou manor on the right. The native
532×144px panels have hard-alpha cleanup and aligned day/night geometry. The cool night grade
preserves warm manor windows; time-of-day sky and weather continue to change normally.

Underworld uses season-neutral supplied cavern artwork year-round: a stone arch and lantern
on the left, repeating cave arches and hazy tunnels in the middle, and an illuminated
palace on the right. The combined artwork is split at source x=1050 and x=2000, with
two-pixel source-grid cleanup and one shared nearest-neighbour scale. Left/right panels
are 360×144px and 596×144px; a 32px overlapped join makes the repeating middle 294×144px.
The original painted ceiling, floor and dark depth haze are preserved, without introducing sky.
Selected blue distant-tunnel pixels are recoloured toward #090a1d, with their depth detail
encoded in varying transparency. Ceiling, floor, architecture and lights retain their original
alpha. Day/night versions use identical transparency and the same dark colour in the deepest tunnels.
Subtler transparency also reveals depth inside the left side of the open doorway, without changing
the arch. Shadows around the palace and in the far-right cavern retain their original opaque artwork.
End panels fade over their inner 48px to soften joins.
The aligned cooler night grade retains warm lanterns and windows, including pale yellow lamp
cores as well as orange light, at their full daytime colour and brightness. The cool cave tint
does not dim or turn them green; darker surroundings and the night halo make them stand out more.
The shared warm night halo uses screen blending, adding light rather than painting orange over
bright cores and reducing their brightness.
Only the left Underworld lantern flickers during both day and night. A pixel-aligned mask isolates
its flame above the steady night halo without affecting the metal frame or palace lights.
Each burst holds full brightness, then flashes one to three times with randomized dips to
40–60% brightness, followed by stepped recovery to full brightness without smooth pulsing.
A generated sequence of 16 randomized bursts varies pauses (10–30 seconds), flash durations,
brightness and recovery levels before repeating, with a randomized starting phase.
Reduced motion disables the flicker.
The Underworld location suppresses the sun, moon, clouds and precipitation.
It uses a flat pale lavender-blue (#b3c5ff) midday backdrop,
fading to #090a1d at sunrise/sunset and throughout night with a squared solar-elevation curve.
The matching dark tunnel pixels disappear into that background at night, while varying
transparency reveals lavender-blue detail by day. It brightens or dims the
semi-transparent distant tunnel haze without a sky gradient.
Stars, celestial orbs, clouds and precipitation are hidden in this location;
weather fog still covers the panorama at half its usual overlay opacity.
Storms briefly illuminate the whole panorama with a flash above the artwork, so opaque cave walls
do not hide it, without outdoor lightning bolts or rainfall. Flashes are disabled for reduced
motion; the artwork's existing day/night grades remain unchanged.
Its overlap defaults to 48px and can be tuned in the artwork demo. Four tiny decorative
bats fly along staggered 8–13 second swooping paths in both the game and demo. Their
64px vertical sweeps ease near the upper/lower turns and accelerate through the centre.
Distinct raised and folded wing silhouettes flap around a steady body. They are
clipped to the cavern and hidden when reduced motion is requested; the original hanging
bats remain in the artwork.

Moon uses season-neutral artwork extracted directly from the original combined landscape sheet:
a ceremonial gateway and pine on the left, a low repeating crater plain in the middle, and
an ivory Lunar Capital palace on the right. Separator gutters and transparent margins are
excluded, with a shared vertical crop and uniform scale preserving the original proportions.
Two-pixel source-grid cleanup and nearest-neighbour resizing produce 339×144px left and
384×144px right panels. Saturated horizon fringe and faint alpha residue are removed.
End panels feather over their inner 32px; a 24px overlapped middle join produces a
277×144px repeating tile without a hard boundary through the lunar dust.
The aligned cool night grade preserves warm palace windows and lanterns. Overlap starts
at the shared 96px default and can be tuned in the artwork demo.

Mountain Foothills includes supplied spring artwork with mossy rocks and a pine on the left,
a repeating flowering valley and stream, and a waterfall, torii and stone lantern on the right.
Four-pixel source-grid cleanup and nearest-neighbour resizing produce aligned 559×144px end panels.
Their inner 96px feather into the repeating backdrop to avoid hard cuts through trees.
The middle tile has a 48px overlapped join, reducing it to 511×144px. Day and night share this edge treatment.
The middle retains its original cherry trees and stream; an earlier cloned-woodland replacement
was removed because it left visible cleanup artifacts.
The matching cool night grade preserves the lantern's warm light and identical transparency
for weather blending. Other seasons use derived palette variations.
The distant blue mountain ridgelines are softened toward the adjacent interior colours without
changing their silhouette or transparency, in both day and night artwork.
Foothill water in every season has a moving highlight overlay: separate colour and brightness filters retain
both cyan water and white foam from the composed daytime panels. Broad highlight bands descend
on a 0.65-second cycle, suggesting falling water and stream ripples without moving rocks or vegetation.
The previous filter rejected white foam and made the effect too faint. It is dimmer at night and disabled
for reduced motion. Shared renderer variables use the spring daytime water-isolation reference in
all seasons: palette variants preserve water and geometry, so winter's pale foliage does not shimmer.

Mountain Summit includes supplied spring artwork at 539×144px per panel. The repeating middle
intentionally retains its rocky mountain sanctuary, sacred stone and windswept pine; the ends
show a large pine and a shrine with cherry blossoms. Source-grid cleanup removes coloured matte
residue and the left source's white bottom border. Inner end-panel edges feather over 64px.
Day and cool moonlit night versions share geometry and transparency. Other seasons use derived palette variations.

Temple, Village, Mansion, Bamboo, Forest, Foothills and Summit now have complete summer,
autumn and winter day/night sets derived from spring using `npm run area-seasons`.
This is selective palette editing, not redrawing: blossoms become green in summer,
vegetation becomes gold/rust in autumn (olive for bamboo), and vegetation and low soil
become cool pale frost colours in winter. No branches, leaf removal or snow geometry are added.
Architecture, water, retained warm lights, image dimensions, alpha and overlap seams are preserved.
Night variants reuse each original pixel's day/night grading. Shrine's individually supplied
seasonal artwork and the neutral Netherworld, Underworld and Moon sets are not modified.
The command skips complete existing sets and reports partially present sets as an error rather
than overwriting artwork.

During bad-weather days the panorama blends toward its matching night set: cloudy/fog 18%, rain 32%, storm 48%,
snow 20%, and blizzard 35%. This requires complete day and night sets; missing night pieces leave the day artwork
unchanged. Clear/fair days and actual night artwork do not receive this blend. Weather overlays remain above it.
Cloudy, foggy, snowy and blizzard nights use muted blue-grey cloud and fog palettes, without changing daytime weather. Obscuring weather adds a second,
softly blurred, translucent sun/moon above the clouds but behind scenery and foreground fog: 2px blur for
cloud/snow, 3px for rain/fog, and a weaker 4px glow for storms/blizzards. Clear and fair skies retain the original
orb without this layer. Cloudy skies use overlapping, shaded cloud banks with a darker night palette.
Night panoramas add a small warm halo isolated from bright window/lantern pixels, leaving the scenery and
moonlit snow sharp. Underground panoramas do not receive this halo.

`HOTPATCH_SKY` includes the exact game minute, season and day in `data-minutes`, `data-season` and `data-day`.
The browser approximates sunrise and sunset at latitude 36 N, with solar noon at 12:00. Each 31-day game season
maps to a quarter of the solar year, starting spring around March 1. Summer has longer days and winter shorter
ones, changing gradually each day; a 30-minute twilight blends the warm sky into night. These are artwork-only
times, not changes to game schedules. The sun peaks at `top: 10px` above the `93px` horizon; the moon follows
an overnight arc. Its transparent crescent artwork has cool ivory shading, subtle craters and a soft
shape-following glow, without a dark disc covering the sky. The weather glow uses the same artwork.
From the Moon location, the nighttime orb instead uses the supplied pixel-art Earth,
with a location-specific sky: muted indigo and silver-lavender by day, dusty rose and
mauve twilight, and violet-black nights. Twilight blends into the same violet night
palette; stars and weather retain their existing behaviour, and Underworld skies are unchanged.
The Earth artwork is
cropped to its globe and resized to 104×104px; its weather glow uses the same image.
Earth's diameter is 3.7 times the 28px moon orb (103.6px), with matching weather-glow
dimensions. Its centre follows the original moon arc without vertical clamping, allowing
the larger globe to rise partly above the header and sink behind the lunar horizon.
Horizontal positioning still keeps the globe on screen where space permits.
Earth and its weather glow fade with the 30-minute twilight: invisible at sunrise/sunset,
fully visible deeper into the night, avoiding an abrupt switch while the large globe is still above ground.
Other locations retain the crescent, and the Moon's daytime sun is unchanged.
Three differently sized star tiles combine fine blue-white and warm stars with occasional
soft bright stars and a faint sky haze, avoiding an obvious repeated grid behind weather and scenery.
The orb stays at least 450px from the right-hand scenery when the header is wide enough and clamps inside narrow
headers. Sunrise and sunset blend the sky and sun into peach, pink and violet. Weather still obscures the orb,
fog covers the whole panorama, and the Underworld hides precipitation and celestial orbs.
Rain uses two independently moving layers of short, slanted drops with varied lengths and opacity.
Storms use denser, faster versions of those rain layers, with staggered 17-second and 23-second
wind cycles changing the rain's slant. An occasional thin forked bolt appears behind scenery, synchronized
with soft blue-grey lightning that illuminates the header
without the former abrupt particle-brightness flashes; reduced-motion mode also disables lightning.
Blizzards use tightly packed fine snow and larger foreground flakes, sweeping steadily sideways at roughly
538px/s and 1005px/s without slowing or reversing. A heavy foreground snow veil obscures the scenery;
its blue-grey night palette avoids turning the night sky white.
The snow veil stays static while the flakes move. Reduced-motion mode also hides the lightning bolt.
Particle tiles travel by whole repeat lengths to avoid loop jumps; reduced-motion mode freezes both layers.

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
