# Emuera.ts

A TypeScript/Node.js interpreter for Emuera/eramaker ERB, with a browser terminal.
Games live under `GAMES/`: eraToho The World (`GAMES/anon-tw-anon-tw_eng-modding`,
the default), eraTohoK (`GAMES/eraTohoK/eraTohoK-master`) and eraRanceK
(`GAMES/eraRanceK`). `KNOWN_GAMES` in `src/loader.ts` fixes their ids, titles
and hotpatches; the server offers each one whose directory exists. At startup it
also offers any other folder in `GAMES/` that holds `ERB/` and `CSV/`, directly
or one level down (e.g. an unzipped `name/name-master`), titled and identified
by the folder name. Use **Refresh library** after adding a game; a restart is not required.
Standard folder names are matched case-insensitively, including `erb/`, `csv/`,
`Resources/` and `Sound/`, on Linux as well as macOS/Windows. Files are not renamed.
ERB files load in each directory before its subdirectories, matching the native
EE engine checked under Wine. `SearchSubdirectory` (Japanese:
`サブディレクトリを検索する`) controls recursion and defaults to off; config layers
apply before discovery. Filenames currently use deterministic case-insensitive
code-unit order, not full .NET culture collation or EE's `#`-folder priority.
As in Emuera, a non-event function defined
twice keeps its first definition and the later one is reported in the
loader diagnostics; only the system `EVENT*` functions may have several.
Game scripts, data, and images are read in place and are not bundled or copied.
Bugs in the game itself (reproducible in real Emuera) are fixed in the game
files and recorded, with a reapplicable patch, in
[game-patches.md](game-patches.md). Presentation improvements, such
as a browser-friendly Palam grid and a paneled main screen, are ERB hotpatches loaded from `hotpatch/`
that leave the game files untouched; see [hotpatches.md](hotpatches.md).

**The real title and custom-character creation work. Full gameplay is not yet
supported.** The unmodified `@SYSTEM_TITLE` executes its startup calls, builds
the talent maps, renders all 35 title-image strips, displays version information
and a random tip, and reaches `INPUT`. Start Game now performs a real reset,
loads the character templates, dispatches `EVENTFIRST`, initializes the full cast,
and reaches mode selection. Choose Custom Character, press Enter at the intro,
and use the actual character editor (including renaming the player). Finishing
and confirming reaches dialogue selection and then map preference. Achievement
initialization now completes with real tables and legacy-achievement checks.
The verified path continues through housing setup: the colored map renders,
a location and room can be chosen, and the run reaches the pre-game settings
menu ("Re-customize yourself") before the day-to-day game loop. Pre-defined-character
selection is not yet supported end to end. Native binary saves can be loaded;
the bundled slot-0 regression reaches the game's `EVENTLOAD` and gameplay input.
Unsupported operations stop with their source filename and line.

Runtime errors also include a **Copy debug report** button. Reports contain the game folder/version,
debug/JIT settings, triggering action and input kind (not the submitted value), current instruction
(truncated to 500 characters), up to 16 active routines, instruction/output budget counters,
deferred-output count, and last loaded save slot. HTTP reports also identify the registered game,
session, and response step. Output sizes count serialized characters, not
UTF-8 bytes. The context is captured before routine unwinding, including errors inside expression
functions and compiled calls.
In development mode, the server synchronously writes an `[era execution]` breadcrumb before
start, input, timeout, and prefetch requests. It includes the PID, game/session/step, action,
debug setting, and heap/RSS measurements, but no submitted text or save contents. These
breadcrumbs can survive a fatal Node out-of-memory crash that cannot produce an ERB error report;
they identify the request being executed, not its final failing instruction.

**eraToho Reverse:** the installed `GAMES/eratohoreverse` is tested through its
title, Normal-mode character creation, character-template and game saving, trainer selection,
the shop, and several initial training turns. ARG/ARGS arrays grow to fit each routine's declared
parameter indices without enlarging other routines or changing `VariableSize.csv`.
Spaced array references, prefix increments, comma-style `CALLF`, empty optional
`TRYCALLFORM` hooks, `CURRENTALIGN()` and integer-times-string repetition work in
both interpreted and JIT execution. Games containing `Emuera-Anchor.exe` default
to automatic integer-to-string conversion for user-function string arguments;
an explicit `emuera.config` setting overrides this, and other games keep their
existing defaults. No game scripts or data are patched for these fixes.
`STR` and its default name-table capacity follow Emuera's 20,000-element default,
so Reverse's training-message scratch ranges above index 1,000 are valid.
Explicit variable sizes still take precedence, and out-of-range accesses still fail.

**eraOCG2:** the installed `GAMES/eraocg2` is regression-tested through the
title animation, new-game confirmation, Story-mode selection, and player-name
entry. Its lexical compatibility report now has no gaps. No game scripts or data are patched.
`ADDDEFCHARA`, restricted to `@SYSTEM_TITLE`, adds character template 0 and
the optional positive `最初からいるキャラ` number from `GameBase.csv`, using
the same CSV initialization as `ADDCHARA`. `PRINT_MARK` prints named, nonzero
marks as `nameLVlevel ` in index order and ends the line.
`SKIPLOG` controls message skipping: output remains visible, `MESSKIP()`
reports the mode, ordinary message waits are skipped, and `FORCEWAIT` or
value input still requires interaction. It does not suppress console logging.
`QUIT_AND_RESTART` unwinds all callers and returns to a freshly initialized
title state, clearing variables, characters, runtime containers, graphics,
and console history while retaining saved files and the current browser
display settings. Interpreter and JIT paths are covered by command regressions.

**eraNAS:** the installed `GAMES/pops-tw` has no lexical compatibility gaps or
loader diagnostics.
`FORCE_QUIT_AND_RESTART` uses the same full runtime reset as
`QUIT_AND_RESTART`, including unwinding nested calls and clearing `SKIPDISP`.
`UPDATECHECK` takes no arguments and sets `RESULT:0` to **4** (disabled).
Other result slots are unchanged.
`CLEARLINE` follows native signed 32-bit count conversion; zero or negative counts
leave output unchanged. This allows loading screens to compare saved line numbers
after other code has cleared the console without aborting on a negative difference.

**eraFL:** startup is regression-tested through initialization, companion-mode
selection, and the unique-companion list with portraits. The engine loads
`CSV/_default.config` (or `default.config`), then `emuera.config`, then
`CSV/_fixed.config` (or `fixed.config`), with later layers taking precedence.
This enables the game's configured XML file reads; `LOADTEXT` resolves
game-relative filenames case-insensitively, including `GLOBAL_GOAL_schema.xml`
whose on-disk name is lowercase. The real schema populates the `GLOBAL_GOAL`
table, and skill XML documents are loaded, rather than bypassing initialization.
`TOOLTIP_FORMAT` supports the native left (0), center (1), and right (2)
alignments and sends changes to the browser tooltip. Other text-format flags
fail explicitly. `HTML_PRINT html, 1` appends to the current print buffer;
the omitted/zero flag retains standalone HTML printing.
`VARI` and `VARS` declare per-call numeric/string locals, including
arrays. Storage is available throughout the routine, while executing each
declaration resets its contents and evaluates scalar initializers at that point.
Repeated declarations reuse the first declaration's storage, and existing
`#DIM`/`#DIMS` locals remain usable with these reset instructions. Recursive
calls have independent inline locals; both interpreter and JIT paths are tested.
`LASTLOAD_VERSION`, `LASTLOAD_NO`, and `LASTLOAD_TEXT` report the most recently
loaded game save, defaulting to `-1`, `-1`, and an empty string. `RESETDATA`
and `QUIT_AND_RESTART` reset that metadata; checking or saving a slot does not
change it. The installed game's new-game path completes `UPDATE` without
the `CSV_NO` declaration failure. Its remaining local compatibility gaps are
implemented: `MAP_CLEAR`, `MAP_FROMXML`, `XML_SET`, `XML_REPLACE`,
`XML_ADDATTRIBUTE`, `XML_REMOVEATTRIBUTE`, `GDRAWGWITHROTATE`,
`SETBGMVOLUME`, and `SETSOUNDVOLUME`. XML mutations support string-variable
writeback, stored documents and `_BYNAME` forms. Map imports merge `/map/p`
entries (key inner text, value inner XML), skipping malformed pairs; clear
preserves the map itself. Rotation persists for subsequent drawing, including
across a full `GCLEAR`, matching the native graphics transform.
The installed report now has only three unsupported `CALLSHARP` occurrences:
the optional Gemini, Ollama and generic LLM API plugins. They remain explicit
errors, not fake successful responses; no provider requests are made.
Full gameplay is not verified. No eraFL scripts or data are patched.
Shop money formatting supports literal currency prefixes/suffixes in `TOSTR`
custom numeric patterns, including `$#,###`, without losing Int64 precision.
The `VARSIZE arrayName` statement inspects an array without reading an element
and writes its dimension lengths to `RESULT:0`, `RESULT:1`, and `RESULT:2`
as applicable, preserving unused result slots. This supports WindowDrawer's
two-dimensional text/property buffers. The expression `VARSIZE("name", dimension)`
continues to return a single dimension length.
Browser HTML `pos` anchors are recalculated after text/wrapper changes, including
asynchronous on-device and browser-page translation, so translated menu labels
do not push WindowDrawer's borders out of alignment.
Routine declarations accept a trailing comma without adding a phantom parameter.
This covers `HAS_CLOTH_TAG`, called by the game's condition-map checks; omitted
call arguments still use the corresponding declared defaults.

**Blue Resort:** the installed `GAMES/erablue_resort` is supported through
its title menu, Normal-mode selection, and full gameplay. Its
original 20 missing instruction types now have implementations, including
targeted TypeScript replacements for its three `CALLSHARP` sites:
`LAUNCH_BROWSER(url)` asks the web UI to open an HTTP(S) URL in a new tab,
with a clickable fallback when browser popup policy blocks it. Unique event IDs
prevent repeated launches when output is replayed or the page is reloaded in the
same tab. A browser-presentation hotpatch turns Blue Resort's Discord title-menu
button into a direct new-tab link, avoiding the extra click and popup restrictions.
No native browser process is launched by the server.
`FixHTML(input, output)` repairs known malformed font tags in
history, and `TranslateDate(input, output)` converts history dates to English
season/day labels. Both history methods clear the writable string output when
no repair applies, preventing a previous result from overwriting unrelated notes.
`FixHTML` preserves already-valid closing tags and does not write the native
plugin's debug log. It is not a general HTML sanitizer. No DLLs are loaded,
other `CALLSHARP` methods still fail explicitly, and the lexical compatibility
report recognizes only these three method names (not arbitrary native plugins).
`ENUMFUNCBEGINSWITH`, `ENUMFUNCENDSWITH`, and `ENUMFUNCWITH` work as both
instructions and expressions, with case-insensitive matching and optional
string-array destinations. `ERDNAME` preserves the original ERD label spelling,
including dimension-specific tables, and `GETNUMB` resolves names dynamically.
Array accesses also resolve bare and string index names against the matching
`Variable@1.ERD`, `Variable@2.ERD`, or `Variable@3.ERD` table, falling back to the
base name table when no dimension-specific table exists, in both interpreted
and JIT execution. The game's party lookup through `BATTLE_STATE@2.ERD` is
regression-tested separately from the new-game menu path.
Brace-delimited multiline CSV records are joined with spaces before parsing,
so character settings spread over several lines remain a single `CSTR` value
instead of producing unknown-field warnings. Template lookups and `ADDCHARA`
are regression-tested against Blue Resort's character 2075.
`UPCHECK` applies the current target's `UP`/`DOWN` deltas and clears those arrays.
`OUTPUTLOG` writes the retained console text (up to 4,096 completed lines plus
pending text) as plain text to the game's
save directory as `emuera.log`, replacing the previous log and reporting the
write. Write failures stop execution rather than pretending the export succeeded.

The separate conformance demo is an original ERB program exercising the supported
subset; it is not the game's title screen. Its character-portraits page composites the
game's highres sprites, swaps to a smile on hover (`srcb`), toggles face close-ups when the current
target is clicked again, and redraws in place with `CLEARLINE`, the way the game's own menus do.
Other pages cover click-to-continue dialogue and a `PRINTC` command grid. Item 8 runs the bundled game
itself straight into its main screen in prepared situations (alone, one person, two, a crowd, time stopped with
and without company, a sleeping partner, exhaustion), for iterating on the main-screen hotpatches.

## Run

Requires Node.js 22.6+ and npm. Run from the repository root:

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000**. Set `PORT` to choose another port.

Fresh visits open the **game library**, with **Installed** and **Not installed**
tabs, short game descriptions, and a Play button for each local game. The library
also works with an empty `GAMES/` folder: TW, K, and Rance are catalog entries,
not required bundled games, and appear under Not installed when absent. Their
monograms include **TW** for The World and **K** for eraTohoK.

The catalog contains nine of the highest-starred public era-game repositories found
through [GitGud's era search](https://gitgud.io/explore/projects?name=era&sort=stars_desc),
excluding tools and unrelated projects, plus TW, K, and Rance. The star counts
are a **2026-10-27 snapshot**, not a live ranking or a compatibility rating.
The nine are EraUma, eraNAS, eraTW Sub-modding, eraToho Reverse, eraAS,
erablue_resort, eraOCG2, eraSQN, and eraMegaten. Descriptions are short
summaries, except eraAS and erablue_resort, which use the era-games group's
published blurbs. Blue Resort is supported for full gameplay. EraUma can be
downloaded with its Git submodules into `GAMES/.downloads/erauma` for source inspection, but it requires its own
era-electron engine and is not added as a playable game. Other known engine
requirements are noted on the cards. The catalog is bundled locally; browsing
it makes no requests to GitGud.
EraUma, eraTW Sub-modding, and eraMegaten are hidden from **Not installed**,
including its count. Their metadata remains available for existing installations
and downloads; local game discovery and the **Installed** tab are unchanged.

When TW is absent, **Install TW** is available directly on the home screen.
One click downloads the
[English modding-branch ZIP](https://gitgud.io/Legis1998/anon-tw/-/archive/anon-tw_eng-modding/anon-tw-anon-tw_eng-modding.zip)
and installs it into `GAMES/anon-tw-anon-tw_eng-modding`, with no Git executable
or account setup in the app. The archive wrapper folder is removed automatically.
This is a large download (about 250 MB at the snapshot date), so allow a few
minutes. ZIP extraction is handled in Node.js, without external unzip tools,
and rejects unsafe paths, links, special files, and oversized archives (512 MiB
download / 1 GiB extracted / 100,000 entries). Network errors are reported with
a manual ZIP-download alternative; existing folders are never overwritten.

eraNAS also uses **Install ZIP**, downloading its `dev/omogatari-kai` branch
with Git LFS assets included. It installs into `GAMES/pops-tw` without Git or
Git LFS; existing Pops TW installations keep the same folder.

**Install with Git** asks before cloning a catalog repository into `GAMES/`.
It requires Git and an internet connection, uses a shallow clone (the repository's
default branch), and may take several minutes. Failed downloads/clones are cleaned
up. Only catalog sources can be installed, not arbitrary URLs. For manual installs,
follow **Project page** or **Find downloads**, download an archive, and extract
the game under `GAMES/`, keeping `ERB/` and `CSV/` together directly or one folder
down. Then use **Refresh library**.

ERD name-index tables may contain numeric rows with an empty name (for example
`1,` in Blue Resort). These reserve unnamed indices and do not create name
lookups; malformed numeric indices still fail loading. If a download completed
but loading failed, the game folder is retained. After updating the loader,
use **Refresh library** rather than downloading the game again.

The **Game library** button returns from a game to the home screen, asking first
before discarding unsaved progress. Direct `?game=...` / `?demo` links and page
reloads still open or restore the requested run rather than the library.

`npm start` (or its equivalent `npm run dev`) watches imported TypeScript modules, `web/`, and the game's
`ERB/`, `CSV/`, and `resources/` trees (including new and deleted files).
Changes restart the backend, reload game data and the compatibility report, and
automatically refresh connected browser tabs once the backend is ready again.
**Reloads reset active interpreter sessions and browser scrollback**; they do
not preserve live game state. The UI shows a reload notice. A disconnected
server is reported while the browser waits for reconnection.

`npm run start:prod` runs the compiled production build without watching or
automatic browser refresh. If switching from the old, already-running
non-watching server, stop that process once, then use `npm start` instead.

The header shows the app name, the current run mode (Game or Demo) and the
interpreter status. While a step runs, the clicked (or typed) choice is
highlighted and the cursor changes immediately; if the step takes more than
~0.1s, a progress bar under the header and a spinner with a live timer slowly
fade in (so very short steps barely register). When
it finishes, the timer stays as the last step's duration (amber when 1s or
longer); hover it for the split between script time (server) and render time
(browser). Every control is in the **☰ menu** at the top right
(keyboard: arrow keys move between items, Escape closes it):

- **Conformance demo**: execute a small ERB program with loops, calls,
  arithmetic, text input, single-character input (menu option 3), HTML choices, an external documentation link, a
  real cropped title-image resource from the local game, and animated sprites (menu option 4: a script-built
  `SPRITEANIMECREATE` animation and the game's CSV `ANIME` halo `30_BG1`).
- **eraToho The World**: execute the real `SYSTEM_TITLE` and display its menu.
  This is the default for a direct game launch; fresh visits show the library.
  Invalid menu choices return to the menu; Start Game reaches custom-character
  creation, but later setup and Continue are not yet supported end to end.
- **eraTohoK**: run eraTohoK's title. It reaches its new-game scenario selection;
  much of the rest is untested. The hotpatches and map/area pictures are
  eraToho The World's only.
- **eraRanceK**, and any discovered game: run its title. Untested beyond that.
- **Restart game…** (or **Restart demo…**): start the current run afresh.
- **Debug mode**: restart the run in Emuera's debug mode (asks first when a run
  is in progress; the choice is remembered). The game is loaded with
  `[IF_DEBUG]` code instead of `[IF_NDEBUG]`, `ASSERT` stops the run with an
  error when its argument is 0, `__FILE__`/`__FUNCTION__`/`__LINE__` are filled
  in, and `DEBUGPRINT*` output appears in a **Debug output** panel under the
  terminal (`DEBUGCLEAR` empties it). Minimize/Expand collapses the output without
  disabling debug mode or discarding logs. Outside debug mode these instructions are
  skipped, as in Emuera. The status shows "Game · Debug" while it is on.
- **Compatibility report**: for the current game, inspect unsupported instruction names, directives,
  and loader diagnostics (such as ignored duplicate functions). It also lists
  instructions that are supported as statements but are called as expression
  functions (for example `IF CHKDATA(0) == 0`) without an expression form, as
  `Expression function (instruction only): NAME`. Literal PRINT/DATA text is
  ignored, and for FORM text only the `{…}`/`%…%` parts are checked.

The selected run is marked in the menu. Choosing another run item switches to
it; switching and restarting ask for confirmation first while a run is in
progress. While the compatibility panel is open, only its item is marked;
choosing the current run item, or closing the panel, returns to the run.

**Reloading the page continues the current run.** The run lives on the server;
the tab remembers its session in `sessionStorage`, and on reload asks
`/api/resume` for the steps shown so far (up to the most recent 8 MB per run)
and replays them, restoring the screen and the pending input without advancing
the game. A run is lost, and a fresh one starts, when it has finished, has been
idle for 30 minutes and been expired, or the server has restarted (including
development reloads). Each response carries a step count that input requests
echo back; if a duplicated tab has moved the same run on, the stale tab is
refused (HTTP 409) and catches up by resuming.

The address names the current game (`?game=tw`, `?game=k`, `?game=rancek`, or `?demo`), so a
fresh run after a server or development reload starts the same game, and a link
opens a particular game. Opening an address for a different game than the tab's
run starts that game; an unknown id falls back to the first game.

Each game keeps its own global data and saves in Emuera's save directory,
and its colors, font and window width from its `emuera.config`. Runs start with
`POST /api/start {mode: "game", game: "<id>"}` (the id defaults to the first game;
add `debug: true` for debug mode, whose snapshots carry `debug` text and
`debugClear`); `/api/runtime` lists the games, and the default game's images are served from
`/resources/`, others' from `/games/<id>/resources/`.

The interface uses the game's configured colors and font, scrollback, keyboard
input, clickable choices, and a font-size slider in the menu. **Settings** edits the text,
background and selected-text colors and the font name. Defaults come from the
game's `emuera.config` (`文字色`, `背景色`, `選択中文字色`, `フォント名`); only
your overrides (and the font size) are stored in this browser's localStorage,
so each browser or user keeps its own preferences. Overrides are sent to the
runtime with every request, so `GETDEFCOLOR`, `GETDEFBGCOLOR`, `GETFONT`,
`RESETCOLOR` and `PRINTD` follow them. Color changes apply immediately; the
runtime picks them up on the next input. Each browser run has its own
runtime. Restarting a run resets its ordinary variables. `SAVEGLOBAL` persists
`GLOBAL`, `GLOBALS`, and header variables declared with the `GLOBAL` modifier
to Emuera's native `global.sav`. `SAVEDATA`, `CHKDATA`, `LOADDATA` and `DELDATA`
use native `save00.sav`, `save01.sav`, etc. Files are stored in the game's `sav/`
directory when `UseSaveFolder` (`セーブデータをSAVフォルダ内に作成する`) is enabled,
otherwise in the game root. Config keys and save filenames are matched
case-insensitively. `SAVECHARA`/`LOADCHARA` use `dat/chara_<name>.dat`.
The 1808 binary format supports sparse integer/string arrays through three
dimensions, character variables and declared saved variables, and the EM
MAP/XML/data-table tail. Gzip-compressed native saves are readable, and
`ZipSaveData` controls compression on writes. Older text-format saves and the
previous `.era-typescript/` JSON format are not supported.
These are shared files, not imported copies: saving or deleting a slot affects
Emuera's saves too. Back up saves before switching engines and avoid running
both engines against the same save directory at once.
Writes use atomic replacement, and corrupt files or I/O failures stop execution
with a diagnostic. The demo uses isolated in-memory globals instead.

Typing anywhere in the game page goes to the input line while the interpreter
is waiting, without needing to click it first. Browser shortcuts, Tab navigation,
and other form controls retain their normal behavior. `INPUT` / `INPUTS` require
Enter (including this game's title menu); `ONEINPUT` / `ONEINPUTS` submit the first
digit / character automatically, including pasted text and completed IME input.
Single-character commands also support their optional default value on Enter.
Menu labels are not used to guess whether input should submit automatically.
The borderless input stays at the bottom of the window, with output bottom-aligned
above it and unused space at the top. Longer output scrolls independently.
Terminal output and input use the bundled **BIZ UD Gothic** Japanese fixed-pitch
font, redistributed under the SIL Open Font License in `web/fonts/OFL.txt`
(source: [Google Fonts](https://github.com/google/fonts/tree/main/ofl/bizudgothic)).
At 16px, ASCII characters measure 8px and full-width symbols such as `★` and `□`
measure 16px, matching the interpreter's two-cell layout assumptions. Widths follow
Emuera's Shift-JIS byte count: JIS characters (`×`, `─`, kana, kanji) are two cells,
and characters CP932 can't encode (such as the `▄` block in status bars) are one;
block elements are drawn clipped to one cell each so bars stay in their columns, and the
corner triangles `◢◣◤◥` (slider ends) are squeezed to one cell. Lines are spaced by the
game's configured line height (`一行の高さ` over `フォントサイズ`, at least 1),
including empty lines and HTML paragraphs, as in
Emuera, so pictures that span lines line up with the text beside them. This is not
MS Gothic or a pixel-identical recreation of native Emuera. The font is served
locally, with no external requests, and startup waits for it before measuring
terminal columns; font-load failure is reported rather than silently measuring a
fallback. Customize `--terminal-font` in `web/style.css` to change the font stack.
The game's configured window width (`ウィンドウ幅`, less Emuera's shape shift, in
half-width cells of `フォントサイズ`; 149 columns for this game) is the minimum
layout width: a narrower browser keeps that layout and scrolls the terminal
sideways instead of squeezing lines the game expects to fit. The terminal's
scrollbar sits in the page's right margin (`--scrollbar-width`, measured with the
columns), so the text has the same space on both sides.
With `ボタンの途中で行を折りかえさない` (ButtonWrap) on, a `PRINTC` item holding a
numeric `[n]` button is laid out as one unbreakable fixed-width cell, so a row of
them (like the game's command menu) wraps between items as Emuera does and lines
up in columns: 5 per line at 149 columns with `PRINTCの文字数` 29. Wrapped rows are
still one logical line for `LINECOUNT`.
A line ending in a run of one rule character (`DRAWLINE`, or a heading padded with
dashes to `DRAWLINESTR`'s width) is clipped rather than wrapped when it is wider
than its box, e.g. after the window was made narrower or in a dialog. HTML keeps
its leading spaces, as in Emuera, so tables built from padded `HTML_PRINT` rows
line up.
An HTML `<div>` with EM+EE sub-area attributes (`width`, `height`, `xpos`, `ypos`,
`size`, `rect`, `depth`, `color`, `display`, `margin`, `padding`, `border`,
`bcolor`, `radius`) is a box placed at the print position plus its offset,
without taking room in the line, as in Emuera (the game prints blank lines
under it, as for images); `display='absolute'` places it against the window's
bottom-left. Games size these from the window width, so sub-areas and the
images in them are scaled to the text columns (149 columns are 1200 px wide)
rather than to the line height, keeping the Body page's layout within the
column width.

Browser snapshots are buffered: the previous completed display remains visible
while clears, HTML and image decoding are prepared off-screen, then the finished
update is committed together. Existing output nodes and their event listeners
are retained during staging; unchanged images are not reconstructed. Scroll
position is preserved unless already following the bottom or starting a new run.
Japanese text the game prints is translated in place by the browser's on-device
Translator API (Chrome/Edge 138 or later; `web/translate.js`). Nothing is sent
off the machine. It is on by default unless the browser's language is Japanese,
and **Menu → Translate Japanese** turns it off, restoring the original text.
The first use downloads the language model, which starts on your next click or
key press. Map art and box-drawing text art are left alone, and tooltips are
translated too. Chrome's own Translate button only translates a page once, so it
misses lines printed later. While it is on (Chrome/Edge's `translated-ltr` class
or its `<font>` wrappers), updates are rendered straight into the live page
(marked `lang="ja"`), but the built-in translator above is the reliable option.
Busy controls do not dim the current screen. Run buttons expose `aria-disabled`
while busy and ignore repeat activation without flashing disabled colors or
losing their hover/focus appearance. This batches each HTTP snapshot,
not every native `REDRAW` boundary; streaming and full native repaint timing are
not yet implemented.
Accepted input is echoed as plain text before the game's response (including
clicked choices and single-character input); rejected input stays editable and
does not enter the scrollback. Echoed input counts as a logical line for
`LINECOUNT` and `CLEARLINE`. `WAIT` continues without adding an input echo.
As in Emuera (which `PrintFlush`es whenever the script stops to wait), a line
left open when input is requested (`PRINT [0] - Return` then `INPUT`) is ended
there, so the echo is a line of its own and `CLEARLINE 1` removes only the echo.
Output continued past a click-to-continue wait stays bright: a run of dialogue
greys out together only once the game stops at a real input (a menu or prompt),
so new choices are shown against greyed history.
While waiting at `WAIT`, clicking the terminal also continues (in addition to
Enter or the Continue button). Links and drags that select text do not
advance; any other click does, clearing a leftover selection (for example a
word picked by a double click), and repeated clicks at one spot don't select
words while waiting.
Clicking a disabled choice (any choice while waiting, or one on an older
screen) counts as a terminal click: browsers send no click event for disabled
buttons, so the client detects the press and release itself.
A terminal click (or Enter) made while a step is still running is remembered:
if that step ends at a click-to-continue wait, it continues straight away.
Only one is kept, and it is discarded if the step ends at any other input.
When clicking through dialogue reaches a real input (a menu), mouse clicks on
its choices and a bare Enter are ignored for 400ms, so a click meant to continue
doesn't land on whichever choice is now under the pointer. Typed input and
keyboard-activated choices are accepted at once.
Once a click-to-continue screen is shown (and its images loaded), the browser
asks the server to run ahead (`POST /api/prefetch`, `Runtime.prefetch()`): the
next step runs while the player reads, so the click is answered at once. The
value given to a wait is ignored, so the click just takes that result. Save and
global writes made while running ahead are staged (`StagedStores` in
`src/storage.ts`) and only persisted when the player continues; abandoned runs
drop them. Timed and blocking waits (`TWAIT`, `TINPUT`) are not run ahead.
Clock functions read while running ahead see the earlier time, and text laid
out ahead uses the columns from the previous request.
Each accepted input retires its output screen: earlier screens are grayscale and
dimmed, with choices disabled and links removed from keyboard/pointer interaction.
Clicked choices retain 70% brightness through
`is-selected` in history after accepted input; surrounding output stays dimmed.
This does not re-enable interaction. Typed input does not guess a matching choice.
Only the latest screen has active choices. Rejected input leaves the current
screen active. Line clearing and scrollback limits still operate on output lines
across screen boundaries, not on the screen wrappers. When `CLEARLINE` removes
output back into a retired screen (for example a "You simply can't enter." `WAIT`
message that is cleared before the script re-asks the same `INPUT`), that screen
becomes active again and its choices work. As in Emuera, those revived choices
stay valid only until the script prints new choices; after that they are disabled,
and the revived output (up to where the new output starts) moves back into a
history screen of its own, greyed like any older screen.
Game HTML `title` descriptions (including trait `<nonbutton>` tags) appear in
immediate, multiline tooltips on hover or keyboard focus. Descriptions are plain
text, not executable HTML; as in Emuera.EM/EE, a literal lowercase `<br>` in
the description becomes a line break, and each line is translated separately.
Tooltip targets have a `has-tooltip` class and a subtle
dashed underline that brightens on hover or keyboard focus without moving.
A subtle CSS text glow adds emphasis while preserving the game's text colors.
Tooltip text and bracketed choice labels are wrapped in `.interactive-label`
spans, leaving square brackets and surrounding whitespace undecorated. Unbracketed
choice labels (including clickable section headings) are not underlined.
Choice underlines use `slategray` and `from-font` thickness. Nested game HTML
styling is preserved, and the entire original target remains hoverable/clickable.
The transition respects reduced-motion preferences. Escape, scrolling, and advancing the screen dismiss
the tooltip; historical screens do not expose active tooltips.
Plain-text numeric menu markers, including padded forms such as `[  0]`, are
clickable choices; their original spacing is preserved. Each marker includes
the following label up to the next marker or end of that text fragment, excluding
trailing whitespace. Choices use yellow hover/focus for neutral text and amber
for chromatic text, including explicitly colored HTML children; only bracketed
label text is underlined. Applied text colors receive `has-text-color` and
`text-color-neutral` or `text-color-chromatic` classes. The heuristic treats
RGB channel spreads of 24 or less as neutral; it does not infer game state.
The CSS variable `--choice-hover-color` controls each category's hover color.
ERB-defined buttons, including section headings, retain their original input values.
`PRINTPLAIN` and `PRINTPLAINFORM` suppress automatic choice recognition,
including for bracketed numbers. Both continue the current line; the latter
evaluates FORM interpolation and padding while the former prints literal text.

`DRAWLINE`, `CUSTOMDRAWLINE`, `DRAWLINESTR`, and `MAXWIDTH()` use the same
measured terminal column count rather than a fixed 80-character width. Custom
separators repeat whole patterns using half/fullwidth character widths.
Scrollbar space is reserved so scrolling does not shrink the measured width.
The browser sends an updated column count with each input, so newly generated
output follows window/font-size changes; existing scrollback is not regenerated.

Terminal presentation can be customized in `web/style.css`: use
`--terminal-foreground` / `--terminal-background` for the default palette,
`.output-text` for output fragments, `.align-left` / `.align-center` /
`.align-right` for lines, and `.font-bold` / `.font-italic` / `.font-underline`
for ERB font styles. Plain text uses one span per fragment, without redundant
wrappers or inline default styles. Explicit non-default ERB colors use only
`--output-color` / `--output-background` inline variables, preserving mixed-color
lines; non-default whole-line backgrounds use `--line-background`.
Game HTML colors and dynamic image dimensions remain explicit.

```sh
npm test          # unit, loader, HTTP and optional local bundled-game integration
npm run check    # strict TypeScript checking
npm run build
npm run start:prod # compiled backend, no watch or automatic browser refresh
npm run compat   # JSON compatibility inventory on stdout
```

The local-game integration test skips when the ignored game directory is absent.
Keep `web/` alongside `dist/` when running the build. The server requires the
game's `ERB/`, `CSV/`, and `resources/` directories.

### Native compatibility checks

`test/native-compat.test.ts` and `test/history-compat.test.ts` run the ERB fixtures
in `test/fixtures/` in interpreted and warmed JIT execution. The control-flow,
numeric, history (including `native-history-arrays.erb`), and string-builtin
fixtures were also run unchanged with **Emuera.NET 1.824+v24+EMv18+EEv56
NAudio** under Wine. To repeat the native check, make a throwaway game folder
with empty `CSV/` and an `ERB/` containing one fixture, copy a compatible
`Emuera.exe` there, enable `システム関数の上書きを許可する:YES` in
`emuera.config`, and run `wine ./Emuera.exe` from that folder. For
`native-history.erb`, also copy `native-history.erh` into `ERB/`. Each fixture
writes `emuera.log` with `OUTPUTLOG` and ends at `DONE`; compare its printed
lines with the expectations in the TypeScript test. Do not run these probes
inside an installed game's directory. The browser runtime additionally prints
its existing `Log written to emuera.log` notification.

The verified behavior includes NAND/NOR short-circuiting, `RETURN 0` when a
normal routine reaches its end (without clearing other result slots),
expression-function fall-through preserving `RESULT`, FOR/REPEAT counters
advancing on `BREAK`, ignored trailing argument separators, comma-before-compound
assignments, statement `==` assignment, and the unset default-character value
of `-1`. Native string `<=` and `>=` both behave as strict `<`; this legacy
quirk is intentional, including in JIT and `CASE IS` comparisons. Shift-JIS
width counts an unencodable supplementary character as two UTF-16 fallback bytes.
Scripts, CSVs, and config files accept CRLF, LF, and lone CR line endings.

History-derived regressions preserve semicolons in string `=` assignments while
retaining comments in numeric and string-expression assignments, including when
a local shadows a differently typed global. Statement expression arguments expand
`#DEFINE` macros before splitting on commas; literal output and quoted strings
are not expanded. A game variable named `VARS` can be assigned normally.
Character templates accept `Chara*.csv` names without numeric suffixes. Empty
templates are skipped, malformed number rows and data before the number produce
diagnostics, and duplicate template numbers keep the first definition.

`EJAC:0` starts at 10000; `GAMEBASE_GAMECODE` aliases `GAMEBASE_CODE`;
`ISDEFINED` tests macro existence, not variable existence. `PRINTCPERLINE X`
stores the configured count in X (or RESULT when omitted). TRAIN respects
`COM_ABLE初期値` when a command has no explicit `@COM_ABLEn` routine.
TRYLIST blocks attempt formatted FUNC targets in order and execute only the first
existing target, without evaluating arguments of missing targets. Calls can wait
for input; jumps unwind the current routine. As with other computed gotos,
TRYGOTOLIST cannot enter a loop from outside. Routines containing TRYLIST remain
interpreted; JIT callers correctly handle their suspension.

`VARSETEX` works as both an instruction and an expression returning 1; only the
instruction writes RESULT. One-dimensional fills ignore an embedded element
index. Numeric multidimensional fills can span all rows, beginning at the larger
of the embedded final index and `from`; string arrays fill only the selected row,
even with `setAllDim` enabled. These cases are checked against the native fixture
and the [VARSETEX reference](https://evilmask.gitlab.io/emuera.em.doc/Reference/VARSETEX.html).
Native character fills use character zero and interpret embedded indices as data
coordinates, not normal explicit-character/TARGET addressing. Missing values and
fills outside the final dimension report script errors rather than silently
defaulting or truncating the range.
`ENUMFILES` preserves the script's directory spelling in returned Windows paths,
while resolving directories case-insensitively. Native probes and the
[ENUMFILES reference](https://evilmask.gitlab.io/emuera.em.doc/Reference/ENUMFILES.html)
confirm the prefix behavior; game-directory confinement and symlink protection
remain enforced.

Expression functions reject executed native method-unsafe instructions such as
CALL/JUMP, RETURN, BEGIN, QUIT and waits, including PRINT...W variants.
Plain printing, RETURNF and CALLF remain allowed. The existing eraFL VARI/VARS
local-declaration extension remains supported inside expression functions.
The main-screen hotpatch's command-rendering helper is an ordinary CALL/RETURN
routine because it calls game routines, rather than a #FUNCTION.

Numeric conversion checks distinguish `ISNUMERIC` from `TOINT`: empty base
prefixes are not numeric, signed exponents are rejected by `ISNUMERIC` but
accepted by `TOINT`, and a missing exponent in `TOINT("4e")` is an error.
Both functions report overflow instead of wrapping or quietly returning zero.
Full 64-bit hexadecimal/binary bit patterns still convert to signed values.

Regex compatibility includes Unicode predefined classes and word boundaries,
.NET capture numbering (unnamed groups before named groups), `Regex.Escape`
punctuation/whitespace, and replacement tokens `${name}`, `$0`, `$+`, `$_`,
`$&`, ``$` ``, `$'`, and `$$`. An undefined numeric group such as `$12`
stays literal rather than falling back to `$1` plus `2`. This is not complete
.NET regex compatibility: supplementary-character matching still uses JavaScript
Unicode semantics, and numeric pattern backreferences are not remapped for
mixed named/unnamed captures. Invalid JavaScript regex syntax reports a script error.

Reference checks:
[Emuera operators](https://evilmask.gitlab.io/emuera.em.doc/Emuera/operand.html),
[RETURN](https://evilmask.gitlab.io/emuera.em.doc/Reference/RETURN.html),
[BREAK/CONTINUE](https://evilmask.gitlab.io/emuera.em.doc/Reference/CONTINUE.html),
[configuration](https://evilmask.gitlab.io/emuera.em.doc/Emuera/config.html),
[TOINT/ISNUMERIC](https://evilmask.gitlab.io/emuera.em.doc/Reference/TOINT.html),
[ISDEFINED](https://evilmask.gitlab.io/emuera.em.doc/Reference/ISDEFINED.html),
[TRYLIST](https://evilmask.gitlab.io/emuera.em.doc/Reference/TRYLIST.html),
[.NET regex substitutions](https://learn.microsoft.com/en-us/dotnet/standard/base-types/substitutions-in-regular-expressions),
and [.NET character classes](https://learn.microsoft.com/en-us/dotnet/standard/base-types/character-classes-in-regular-expressions).
Other engines' tests are leads, not an oracle: native EE reports errors for
numeric overflow and uses culture-dependent number formatting. Broader `TOSTR`
formats, additional `REPLACE` modes, Anchor translation, and
full filename-collation/priority behavior still need separate compatibility work.

## Implemented subset

Identifier normalization is memoized in a bounded process-wide cache (65,536
entries, identifiers up to 256 characters). Argument splitting is cached per
runtime (16,384 entries, source strings up to 4,096 characters). Each runtime
also caches parsed `FORM` strings, assignment targets and operators, `CALL`
targets, `CASE` tests, and per-routine metadata (return type,
`DYNAMIC`/`REF` declarations, parameter targets and defaults). Variable
accesses normalize names once, and routines without `DYNAMIC`/`REF`
declarations reuse their evaluation context. Only lexical results are reused:
expressions are evaluated against current state on every execution. Inputs
beyond the cache limits are processed normally.

Execution hot paths are tuned for the game's call-heavy daily processing:
variable elements are stored in integer-keyed maps by row-major index (save
files keep the `i:j:k` address form); each scope caches name resolution
through its parent chain, invalidated when a scope with children changes its
declarations or references; compiled instructions keep their parsed
expressions, assignments and `CASE` tests; the most frequent instructions
(assignment, `IF`/`SIF`, loops, `SELECTCASE`, `RETURNF`) dispatch first; user
functions bypass builtin lookup once resolved; a function whose body is a
single `RETURNF` is evaluated without a generator; and literal `FINDELEMENT`
patterns skip the regex engine. Hot paths also avoid allocating closures per
call, which matters under `tsx` (`npm run dev`) because its esbuild
`keepNames` transform makes each closure creation expensive.

Two further layers can be switched off with the `Runtime` options
`intrinsics: false` and `jit: false`. Both are on by default.

- **Intrinsics** (`src/intrinsics.ts`) are native replacements for known game
  routines. Currently this covers the eraTW OBJ framework (`GET_INT`/`GET_STR`/`GET_OBJ`/
  `OBJNAME_TO_ID`/`GET_EXIST`/`MAKE_INT`/`MAKE_STR`), which otherwise
  dispatches through `CALLFORMF` and a name table on every lookup.
  Replacements are enabled only when the SHA-256 hash of the routine
  sources matches the version they were written against. Any edit to
  those routines falls back to the ERB.
- **JIT** (`src/jit.ts`) compiles a routine to a JavaScript function on its
  second call. Unsupported constructs fall back to single-stepping
  the interpreter for that line, or for the whole routine.
  - Compiled code is cached per loaded game and shared across `Runtime`
    instances, such as Start Game resets and test runs.
  - A static call-graph analysis over the raw routine lines (`FORM` call names
    are matched as globs) finds which routines can reach an input or wait.
    Only those routines run as generators.
  - Everything else, including calls into non-waiting routines, runs as plain
    synchronous JavaScript. Output is buffered in order.
  - If compiled synchronous code unexpectedly requests input, the runtime
    raises an internal error rather than losing the request.

On the "Wake up" flow (about 580k ERB lines), steady-state time is about 1.5×
faster than the interpreter (≈0.8s vs ≈1.2s). The first run is about the same
as the interpreter, because it pays ≈0.5s of compilation and analysis. The
remaining cost is spread across per-call overhead: scope setup, `DYNAMIC`
declarations and the expression evaluator. No single routine dominates.

- Recursive, deterministic ERB/ERH, ERD name-index and CSV discovery; UTF-8/BOM, UTF-16LE BOM,
  and strict Shift-JIS decoding. Source filenames and original line numbers
  survive indexing. Release- and debug-mode `[IF_DEBUG]`, `[IF_NDEBUG]`, `[ELSE]`,
  `[ENDIF]`, and `[SKIPSTART]`/`[SKIPEND]` handling.
- Macro-definedness conditionals `[IF NAME]` / `[ELSEIF NAME]` / `[ELSE]` /
  `[ENDIF]`, including nesting. Headers are loaded before ERB scripts.
  `[IF DEBUG]` tests whether a `DEBUG` macro exists; unlike `[IF_DEBUG]`, it
  does not test engine debug mode. Macro text expansion remains unsupported.
- Brace-delimited multiline statements are joined before comment processing,
  indexing, execution, and compatibility reporting. Diagnostics point to the
  first content row; quoted array values are not counted as instruction names.
  Builtin functions written as statements (`SPRITECREATE "X", G`, `LIMIT A, 0, 9`)
  count as recognised and store their value in `RESULT`/`RESULTS`, and repeated
  `EVENT*` definitions are normal event dispatch rather than gaps. Assignment
  lines with an extra left-hand comma (`VALUE ,= ,`) fail when executed, as in Emuera.
- Literal `PRINT` / `PRINTFORM` arguments preserve layout whitespace after the
  single command separator, including leading, trailing and full-width spaces.
- Indexed functions and labels; ordinary `CALL`, `JUMP`, `RETURN`, `GOTO`,
  `GOTOFORM`, and `TRYGOTO`/`TRYGOTOFORM` (which go on when the label is missing).
  `RESTART` repeats the current routine without rebinding arguments or resetting
  locals, clearing active loop bookkeeping and retaining the instruction budget.
  Numeric parameter targets such as `ARG:0` and private declared parameter
  targets, including default expressions and legacy comma-prefixed signatures.
  `CALLF`, `CALLFORM`, `CALLFORMF`, `TRYCALLF`, `TRYCALLFORMF`, `TRYCALLFORM` and `TRYCCALLFORM`/`CATCH`/
  `ENDCATCH` support dynamic dispatch; missing-target branches do not swallow
  errors inside existing routines. `CALLF`-style instructions discard the return
  value. Expression functions may print (output appears before the caller's);
  input inside them is an error. Bounded recursion shares static locals and
  creates fresh `DYNAMIC` locals. `#LOCALSIZE` and `#LOCALSSIZE` are respected.
- `RESETDATA` resets ordinary and private state while preserving globals, constants
  and title/CSV metadata. `ADDCHARA` instantiates numbered character CSV templates;
  character variables have isolated storage and omitted character indices use
  `TARGET`. `CHARADATA` header variables (up to 2 dimensions per character, optionally
  `SAVEDATA`) move with characters through `ADD`/`DEL`/`SWAP`/`COPY`/`PICKUPCHARA`,
  saves and `SAVECHARA`. `REF` parameters (for CALL and expression functions) bind the
  caller's whole array as in Emuera: an index on the argument is ignored, a sizeless
  `REF` is 1-D, and constants, character variables, other types and other ranks are
  rejected. `BEGIN FIRST` unwinds the caller and dispatches `EVENTFIRST`
  routines in `#PRI`/normal/`#LATER` order, respecting `#SINGLE`.
  `FORCE_BEGIN` accepts the same states and uses the same transition and style
  reset as `BEGIN`; this interpreter already allows `BEGIN` from nested routines
  without the native engine's system-state restrictions.
  `_Rename.csv` substitutions are applied before script indexing.
- Character CSV queries (`EXISTCSV`, `CSVNAME`, `CSVCALLNAME`, `CSVNICKNAME`,
  `CSVMASTERNAME`, `CSVBASE`, `CSVABL`, `CSVTALENT`, `CSVEXP`, `CSVRELATION`,
  `CSVFLAG`, `CSVCFLAG`, `CSVMARK`, `CSVJUEL`, `CSVEQUIP`, `CSVCSTR`), bounded `RAND:n`,
  `FINDELEMENT`, `ARRAYREMOVE`, bit manipulation, FORM field padding,
  hexadecimal `TOSTR`, Unicode/string/HTML helpers support new-game setup.
  Character CSV numeric fields follow Emuera's leading-integer parsing, allowing
  trailing notes; omitted values mean 1. Invalid nonempty values that default to
  1 are explicitly recorded in diagnostics.
- Session-local data tables: `DT_CREATE`, `DT_EXIST`, `DT_RELEASE`, `DT_CLEAR`,
  `DT_COLUMN_ADD`, `DT_ROW_ADD`, `DT_ROW_LENGTH`, `DT_COLUMN_LENGTH`,
  `DT_CELL_GET`, `DT_CELL_GETS`, `DT_CELL_ISNULL`, `DT_CELL_SET`, and
  `DT_SELECT`, as commands and expression functions. Columns support strings and
  signed 8/16/32/64-bit integers, nullable cells and Emuera's integer clamping.
  Row positions are zero-based; opaque positive IDs remain stable and support
  ID-based lookup. Selection returns its count and populates `RESULT:1` onward
  with matching IDs. Filters currently support a single case-sensitive equality
  comparison against a quoted string (with doubled-apostrophe escaping) or integer.
  The bundled catalog creates 75 actual achievement rows; regression tests also
  verify a legacy achievement's claimed/completed state.
- Achievement helpers: `SUMARRAY` for bare one-dimensional numeric arrays with
  optional start/end-exclusive bounds; binary/decimal exponent integer literals
  (`1p4`, `2e3`); string-valued FORM conditionals inside expressions;
  and `MONEYSTR` with plain, zero-padded or `#,##0` formatting. Currency label
  and prefix/suffix placement come from `_Replace.csv`.
- User-defined `#FUNCTION` / `#FUNCTIONS` expression functions and `RETURNF`,
  typed results, defaults and omitted expression-call arguments. Expression
  functions cannot yield output or request input.
- A parsed expression AST, never JavaScript `eval`. Signed 64-bit integer
  arithmetic, comparisons, bitwise operators, short-circuit logical operators,
  `? ... # ...` conditionals, strings, array access, and selected built-ins
  (`ABS`, `MIN`, `MAX`, `LIMIT`, `TOSTR`, `TOINT`, `STRLENU`, `MAXWIDTH`,
  `GETCOLOR`, `GETSTYLE`, `EXISTVAR`, `GETVARS`, `VARSIZE`, `GETNUM`).
  Bare array indices bind tightly; parenthesize computed indices.
  Prefix and postfix `++`/`--` work inside expressions and computed assignment
  indices (`ITEMS:(COUNT++) = 7`); each index is evaluated exactly once.
- `ISNUMERIC` and `TOINT` follow Emuera's literal parser: `0x`/`0b` prefixes,
  `e`/`p` exponents and an ignored `.digits` tail are accepted. Non-numeric
  strings (including any full-width character) give `ISNUMERIC` 0 and `TOINT` 0.
- Full-width spaces (U+3000) count as whitespace only when the config
  `全角スペースをホワイトスペースに含める` is YES (Emuera's default). This game sets
  it to NO, so leading/trailing U+3000 in values such as colored map rows is kept.
- Sparse, bounds-checked numeric/string variables; one- to three-dimensional
  `#DIM`/`#DIMS`, constant initializers, ERH globals, static private variables,
  and per-call `DYNAMIC` private variables.
  Declarations initialize lazily on access. A subset of built-in arrays is
  available; the full Emuera variable catalog is not implemented.
- CSV name-to-index mappings and `*NAME` tables, plus basic GameBase metadata.
  Basic built-in array sizes come from `VariableSize.csv`; trailing empty CSV
  fields (including before comments) are ignored, but missing or invalid
  dimensions are rejected. `-1` disabled arrays are not accessible.
  This game's `proto` version marker maps to the unversioned
  numeric version `0`, allowing its ERB version formatter to run. Other
  non-numeric version markers still fail explicitly.
  Character CSV templates are instantiated by `ADDCHARA`, including initial
  names, stats, flags, relationships, juels and character strings. Keys may be
  Japanese or Emuera's English names (`CFLAG`, `NAME`, `BASE`…, any case);
  unknown keys are reported at load and skipped, as in Emuera.
- `IF`/`ELSEIF`/`ELSE`, single-instruction `SIF`, `SELECTCASE` (values,
  inclusive `TO` ranges, `IS` comparisons, default), exclusive-end `FOR`,
  `WHILE`, `DO`/`LOOP`, `REPEAT`, `BREAK`, and `CONTINUE`.
- Plain `PRINT`/`PRINTL`/`PRINTW`; `PRINTFORM`, `PRINTV`, `PRINTS` variants
  with optional `L`/`W`; basic `{integer}` and `%string%` interpolation;
  string `=` formatted assignment and `'=` expression assignment;
  numeric compound assignment and increment/decrement. Numeric `=` and string
  `'=` batch assignments advance along the final array dimension without wrapping.
  Expression assignments ignore trailing `;` comments while retaining semicolons
  inside quoted strings; string `=` formatted assignments keep literal semicolons.
- `@"..."` formatted string expressions, nested interpolation and lazy
  `\@ condition ? true text # false text \@` FORM conditionals. As in Emuera's
  lexer, conditionals do not nest: inside an arm the next `\@` closes it (a
  missing `#` arm is allowed), `"` is literal text and only `%…%`/`{…}` are
  expressions. `\s`/`\S` are half/full-width spaces. Comments and argument lists
  correctly handle nested quoted expressions inside FORM strings.
- `MAP_CREATE`, `MAP_RELEASE`, `MAP_SET` and `MAP_EXIST`/`MAP_SIZE`/`MAP_HAS`/
  `MAP_GET`, backed by actual runtime maps. Flat `PRINTDATA`/`PRINTDATAL`/
  `PRINTDATAW` blocks choose randomly among `DATA`/`DATAFORM` entries.
- Array scans (`MATCH`, `MAXARRAY`, `MINARRAY`, `FINDELEMENT`, `FINDLASTELEMENT`,
  `SUMARRAY`) and character scans (`CMATCH`, `MAXCARRAY`, `MINCARRAY`,
  `SUMCARRAY`); value-filling and ranged `VARSET`; `__INT_MAX__`/`__INT_MIN__`.
- String instructions (`STRLEN*`, `STRLENS*`, `SUBSTRING*`, `STRFIND*`,
  `STRCOUNT`) store into `RESULT`/`RESULTS`; `TOFULL`/`TOHALF`.
- Bare `RETURN` sets `RESULT:0` to zero (leaving other result elements unchanged),
  rather than preserving a previous call's return value. This also applies to JIT execution.
  `RETURNFORM` formats its argument, then evaluates the resulting comma-separated
  integer expressions into `RESULT` before returning. `BARSTR(value, max, length)`
  returns the same clamped bar as the `BARSTR` statement writes to `RESULTS`.
  `SAVENOS [destination]` writes the configured save-slot count (default 20)
  to the destination or `RESULT`; `SAVENOS()` returns that count.
  `PUTFORM` appends formatted text to the writable, unsaved `SAVEDATA_TEXT`
  string, which the default autosave clears before calling `SAVEINFO`.
  `SORTCHARA [variable[, FORWARD|BACK]]` stably sorts character data by the
  chosen element (default `NO`), keeping `MASTER` in place and remapping
  `TARGET`/`ASSI`. These features cover eraAS's current lexical compatibility
  gaps; its new-game, autosave and manual-save flow has a regression test.
- `SPLIT` (optional count variable, default `RESULT`; truncates to the array),
  `REPLACE`, `STRLENS`, `HTML_TOPLAINTEXT`, and `HTML_POPPRINTINGSTR` support
  the game's tip-wrapping helper. HTML-to-text parsing uses parse5; popped print
  text is removed from the browser before the wrapped replacement is rendered.
- Timed input: `TINPUT`/`TINPUTS`/`TONEINPUT`/`TONEINPUTS` and `TWAIT`. The browser
  runs the timer and calls `/api/timeout` on expiry; the runtime then prints the
  timeout message (`時間切れ表示`, default 時間切れ), replacing the optional
  "残り" countdown line, and echoes the default as the input. As in Emuera, an
  empty Enter before expiry does not take the default, and `TWAIT` with a
  nonzero flag cannot be skipped. Input made while an animation frame is loading
  is sent once the frame is shown, so the animated colored map stays usable.
- `INPUTMOUSEKEY [timeout]` hides the input box and sends the next click
  (left/middle/right, with RESULT:4 = -1 and RESULT:5 the clicked button's value,
  or RESULTS for a string button), wheel notch (±120) or key (its Windows key
  code, plus Shift/Alt bits in RESULT:2) as RESULT:0-5. Positions are Emuera
  client pixels from the bottom-left, so y is negative. A timeout gives RESULT:0 = 4.
- `INPUT`, `INPUTS`, `ONEINPUT`, `ONEINPUTS` (their argument is the value an empty
  input gives, shown as the input box placeholder; FORM text for the `S` forms),
  `INPUTMOUSEKEY`, `WAIT`, `FORCEWAIT`, `PRINTBUTTON`/`PRINTBUTTONC`,
  `HTML_PRINT`, line drawing/clearing, RGB colors, alignment, `THROW`, `QUIT`.
  Output and input requests are structured events, independent of the browser.
  `HTML_PRINT` finishes any pending plain-text line before printing its HTML,
  as Emuera does; empty HTML prints nothing. This keeps upward-offset portraits
  below preceding controls when scripts reserve their space with `<br>` lines.
  `FONTSTYLE` carries bold (1), italic (2), strikeout (4) and underline (8);
  `FONTBOLD`/`FONTITALIC`/`FONTREGULAR` adjust it. The `PRINT` family (including
  `S`/`V`/`FORMS`, `C`/`LC` alignment, `K`/`D` modes, `PRINTSINGLE*`, `PRINTPLAIN*`),
  `CUSTOMDRAWLINE`/`DRAWLINEFORM` are supported; `REDRAW` reads bit 0 (off/on),
  accepting refresh bit 1 and ignoring higher bits as Emuera does, and uses the existing
  snapshot buffering. Release-mode debug instructions (`DEBUGPRINT*`,
  `DEBUGCLEAR`, `ASSERT`) do not evaluate their arguments; in debug mode they
  write to the debug output panel or check the assertion. `CLEARMEMORY` clears interpreter parser/compiler caches and
  requests V8 garbage collection when Node exposes it; it returns observed
  reclaimed heap bytes (possibly zero).
- `CALLTRAIN`/`STOPCALLTRAIN` queue `SELECTCOM:1..n` train commands as in
  Emuera: status/command list output is skipped during the run, each step prints
  `＜コマンド連続実行：i/n＞`, unavailable commands go to `USERCOM`, and
  `@CALLTRAINEND` runs at the end. While output is skipped, input instructions
  are skipped too; `SKIPDISP` sets `RESULT`.
- `PRINT_RECT`/`PRINT_SPACE` emit inline `<shape>` rectangles/spaces.
- `BINPUT`/`BINPUTS` validate typed and clicked input against the active retained
  buttons; no buttons means an immediate default, or an error without one.
  `INPUTANY` writes numeric input to `RESULT` and other input to `RESULTS`.
  `SETTEXTBOX` updates the browser field and `GETTEXTBOX` reads the runtime's
  value; unsent browser edits are not observable by a running script.
  BINPUT's optional nonzero mouse-side-channel mode still fails explicitly.
  `ARRAYMSORTEX` reorders named arrays together, supports ascending/descending
  order and explicit counts, and validates all targets before changing them.
  `ENUMFILES` supports wildcards, recursion and output arrays. Paths are confined
  to the game directory, case-insensitive, and returned with Windows separators;
  recursive searches skip symlinks. `MAP_GETKEYS` supports joined and array output,
  `MAP_REMOVE` removes keys, and `MAP_TOXML` exports escaped key/value pairs.
- `PRINT_IMG` shares the inline HTML sprite renderer, including hover sprites,
  dimensions, offsets and color matrices. `SPRITEDISPOSEALL(0)` preserves
  resource-CSV sprites; a nonzero argument disposes them for that runtime only.
  `GSETPEN`, `GSETFONT`, `GDRAWLINE` and `GDRAWTEXT` create browser canvas
  operations. `GGETFONT`, `GGETFONTSIZE` and `GGETFONTSTYLE` read that state.
  `GGETTEXTSIZE` and `HTML_STRINGLINES` use fixed-cell measurements, not exact
  platform GDI+ font metrics. `STRFORM` expands FORM text without printing.
  `EXISTSOUND` checks local sound files.
- `PLAYBGM` loops local background audio; `PLAYSOUND` plays up to ten concurrent
  effects with an optional repeat count (minimum one). `STOPBGM`/`STOPSOUND`
  stop the respective channels. `SETBGMVOLUME`/`SETSOUNDVOLUME` clamp to 0..100,
  affect existing and future playback, and leave `RESULT` unchanged.
  The server serves allowlisted MP3/WAV/Ogg/FLAC/M4A/AAC files from the game's
  sound directory only; codec support depends on the browser. Playback and
  loading errors are displayed. Autoplay restrictions prompt for a click/key
  and retry on that gesture. Resume restores BGM and volumes, but does not
  replay old effects. New runs and library return stop the old audio.
  Terminal-only clients receive the same audio state but do not play it.
- Tooltip custom font, font size, colors, delay and duration settings are sent to
  the browser. Textbox and tooltip settings survive session resume.
- Resource CSV sprite rectangles and local PNG/WebP/JPEG/GIF/BMP serving.
  Named `<img src='SPRITENAME'>` images are cropped from sprite sheets.
  Basic HTML paragraphs, breaks, emphasis, fonts (color only), numeric choices,
  nonbuttons and HTTP(S) links are rebuilt as allowlisted DOM nodes.
  Hotpatches may also use `<div>`, `<meter>`, `era-*` classes and
  `<era-open>`/`<era-close>` box markers, which are not Emuera features (see [hotpatches.md](hotpatches.md)).
  As in Emuera, an image is drawn from the top of its line (shifted by `ypos`)
  and does not make the line taller. Scripts print blank lines to reserve its
  height, so the picture overlaps those lines rather than pushing them down.
  Image sizes and offsets are in the game's units: unitless values are
  percentages of the configured font size (`フォントサイズ`) and `px` values are
  pixels. Both are scaled from the configured line height (`一行の高さ`) to the
  terminal's line height (which keeps the configured ratio to the font size). Negative sizes flip the image. A picture inside a
  button or tooltip element highlights the whole picture on hover, and its
  tooltip opens below the picture; an `srcb` picture replaces `src` while the
  pointer is over the button, as in Emuera. The game marks the selected
  character (`TARGET`) only by recolouring its name, so every step also reports
  `TARGET` and the client gives the picture button whose value is
  `1000 + TARGET` (the game's picture-button convention) an `is-target` class,
  styled with an aqua glow and underline. The other characters' pictures get
  `is-not-target` and are slightly faded and desaturated until hovered. Unsupported tags and
  missing images show errors.
- Graphics (`GCREATE`, `GCREATEFROMFILE`, `GCLEAR`, `GSETBRUSH`, `GFILLRECTANGLE`,
  `GSETCOLOR`, `GDRAWSPRITE`, `GDRAWG`, `GDRAWGWITHROTATE`, `GDRAWGWITHMASK`, `GDISPOSE`) build
  display lists instead of pixels. As in Emuera, `SPRITECREATE` sprites reference
  their G live: a disposed G makes them "not created". Color matrices are 5x5
  integer array blocks scaled by 1/256. An html output that shows a runtime-made
  sprite carries a snapshot of its picture, which the browser paints on a
  `<canvas>`. `GGETCOLOR` cannot read pixels (it returns 0), `GSAVE`/`GLOAD`
  are unsupported, and animated sprites draw nothing.
  `CBGSETG`/`CBGSETSPRITE` fix a G or sprite to the client area
  (offset from its bottom-left; z > 0 behind the text, z < 0 in front) until
  `CBGCLEAR`/`CBGREMOVERANGE`. A step's snapshot carries the full layer list
  only when it changed, and the server keeps the latest so a reload restores it.
  Referenced graphics are refreshed when their content changes.
  `CBGSETBUTTONSPRITE` carries normal/hover pictures and tooltip text;
  `CBGSETBMAPG` installs a separate pixel hit map. Opaque pixels select their
  24-bit RGB value, switch matching sprites to their hover picture, and populate
  `INPUTMOUSEKEY`'s `RESULT:4` when clicked. Removing buttons does not remove
  the hit map; `CBGCLEAR` clears both, without disposing their source graphics.
  Both visible layers and the hit map survive session resume.
  While back layers are shown, text backgrounds are transparent so they show
  through.
  Browser runs report the actual drawable client width/height in game pixels
  at startup and on input/timer steps. `CLIENTWIDTH()`/`CLIENTHEIGHT()` use those
  dimensions, with the same scale used to place CBG canvases and map mouse
  coordinates, rather than always reporting the configured desktop window size.
  Headless runs retain the configured dimensions. `ISACTIVE()` reports browser
  visibility/focus (headless runs default to active).
  `MOUSEX()`/`MOUSEY()` report the latest pointer position at each execution step,
  in the same game pixels as `INPUTMOUSEKEY`: the origin is the drawable area's
  bottom-left and Y is negative above it. Movement is tracked without clicking,
  including outside the drawable area; coordinates are not clamped.
  Headless runs and browser runs before the first pointer event default to zero.
  Translation protects marked map panels and unmarked text-art rows (box/block
  drawing or repeated forest/tree scenery), including labels in separate spans.
  These receive `translate="no"` and `notranslate` before staged output is shown,
  preserving their character-cell layout with both the on-device translator and
  browser page translation. Ordinary descriptions and menus remain translatable.
  Timed `INPUTMOUSEKEY` frames are capped at 60 FPS: delays shorter than
  1/60 second use that interval, while longer delays and other input timers
  are unchanged. Mouse clicks, wheel events and keys received during a timed
  frame's request/render are queued for the next frame instead of discarded.
  `AWAIT` yields to the browser event loop, including when its delay is omitted
  or zero, so inactive-window polling loops cannot block the server. Explicit
  delays accept 0–10000 milliseconds; the browser transport uses a minimum 1 ms
  timer and does not allow clicks or message skipping to bypass it.
  See [sprites.md](sprites.md) for how sprites are stored, sent and painted.
- **eraFlappyTengu** (separate from eraFL): the unmodified public game is
  regression-tested when installed under `GAMES/eraflappytengu`, through its
  first rendered frame, click-to-play, timed updates, focus loss and resume,
  Escape to exit, and `FORCE_BEGIN TITLE` to play again. Its lexical compatibility
  report has no gaps or loader diagnostics.
  Movement and upward flaps are tested with a controlled clock. The browser's
  60 FPS cap keeps the game's integer-divided physics from rounding to zero
  at sub-15 ms frame times; no game scripts are patched.
  Its lowercase `csv/` directory works without renaming.
- A presentation-only patch recognizes the title's exact 35-strip HTML sequence
  and contiguous resource rectangles, rendering one cropped image instead of
  35 images and metadata requests. ERB files, runtime output and `LINECOUNT`
  remain unchanged. The browser retains 35 logical lines for `CLEARLINE`,
  including partial removal from the bottom. Incomplete/changed sequences,
  inline text, side-by-side images and other HTML use the normal renderer.
  This targeted patch lives in `src/render-patches.ts`, outside the game code.

## Deliberate limits

The compatibility inventory tracks recognized opcodes. Runtime support depends
on their expressions, argument forms, and reachable paths.
For example, this game uses millions of instructions, macros, game-save loading,
character-management operations, additional engine lifecycle transitions, drawing
APIs, and extensions that are not implemented yet.

Not supported: older text-format Emuera saves, `BEGIN` states other
than `FIRST`, full character-management APIs, general random APIs, other event
dispatch or overloaded functions, general macro expansion and replace tables,
the full configuration and
variable-size rules, audio APIs, pixel read-back, arbitrary HTML/CSS, resource animations,
or exact Emuera layout/line-measurement semantics. `MAXWIDTH()` uses terminal
columns measured at browser run start, never fewer than the configured window
width (default 120 in direct/API runs); restart
the run after resizing or changing font size. Some game layouts assume Emuera's
fixed window width (for example the Palam list's items per row), so a wider browser
can wrap them early. `STRLENS`/`SUBSTRING` count CP932 bytes. Regex helpers use
JavaScript regex syntax plus .NET inline options (`(?i)`, `(?m)`, `(?s)`), not
all .NET regex extensions. Only argument-free flat
print-data blocks, basic/padded FORM interpolation, and zero-padded/hexadecimal
`TOSTR` formatting are supported; more complex forms still fail explicitly.
The full data-table extension is not implemented: XML import/export and
persistence, row/column removal, array-reference argument forms, sorting, custom
selection destinations, and general filter expressions still fail explicitly.
Tables are isolated per runtime and are not saved by `SAVEGLOBAL`; IDs use a
monotonic session-local counter rather than the native engine's time-derived values.
The colored-map renderer and subsequent new-game setup remain unsupported.

The first unsupported instruction on an executed path stops that runtime.
Malformed function signatures are diagnosed during indexing and rejected if
called. Unsupported directives remain visible in the inventory. Function-local
unsupported directives stop execution when entering that function.

Game execution on the server is bounded to 250,000,000 instructions between input requests.
eraRanceK's default scenario uses about 187 million while repeatedly rebuilding
its diplomacy maps (around 11 seconds on the development machine); this is finite
setup work, not an infinite loop. Its real new-game path is regression-tested
within that budget. The server's demo shares the budget because its scenarios run the game. Direct runtimes default to
50,000. All runs retain a 2 MB
output limit between input
requests, 128 call frames, 16 KB request bodies, and eight active sessions
(30-minute idle expiry). This is a **local development tool**. It listens only on loopback,
checks Host/Origin, uses a CSP, and prevents resource traversal (including
symlinks). No game-supplied scripts or event attributes are attached to the DOM.

## Layout and next compatibility work

- `src/loader.ts`: script/data/resource indexing and encoding.
- `src/expression.ts`, `src/variables.ts`: expression and variable semantics.
- `src/format.ts`, `src/strings.ts`, `src/html.ts`: FORM and text parsing.
- `src/storage.ts`: memory/file global storage adapters.
- `src/data-tables.ts`: session-local typed data-table storage and lookups.
- `src/save-format.ts`, `src/storage.ts`: native binary save encoding and atomic file persistence.
- `src/compiler.ts`, `src/runtime.ts`: control-flow compilation and execution.
- `src/compatibility.ts`: unsupported-feature inventory.
- `src/server.ts`: HTTP/session/resource adapter.
- `web/`: terminal renderer and input client; `web/areas/` holds the main screen's per-area header art (an SVG per area, plus pixel-art panoramas per season and day/night imported with `npm run area-art`; see [hotpatches.md](hotpatches.md#area-pictures)); `web/maps/` takes optional drop-in pictures for the text maps (see [hotpatches.md](hotpatches.md#map-pictures)).
- `test/`: conformance, HTTP, loader and bundled-game regression tests.

Next work should follow the verified new-game path into housing's colored-map
renderer, then housing/options and the `BEGIN SHOP` game loop.
Pre-defined character selection needs additional character-management operations.
Native Continue is covered through the bundled save's post-load gameplay input;
later gameplay can still encounter unsupported operations.
Keep unsupported behavior explicit and add conformance tests for each feature.

Language references: [Emuera wiki](https://wiki.eragames.rip/index.php/Emuera),
[ERB format](https://wiki.eragames.rip/index.php/Emuera/eramaerb),
[operators](https://wiki.eragames.rip/index.php/Emuera/exop),
[user variables](https://wiki.eragames.rip/index.php/Emuera/UserVars),
[HTML output](https://wiki.eragames.rip/index.php/Emuera/exhtml).
