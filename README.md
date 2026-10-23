# TypeScript Emuera

A Node.js interpreter foundation for Emuera/eramaker ERB, with a browser terminal.
The local game directory `anon-tw-anon-tw_eng-modding` is the default target.
Game scripts, data, and images are read in place and are not bundled or copied.

**The real title and custom-character creation work. Full gameplay is not yet
supported.** The unmodified `@SYSTEM_TITLE` executes its startup calls, builds
the talent maps, renders all 35 title-image strips, displays version information
and a random tip, and reaches `INPUT`. Start Game now performs a real reset,
loads the character templates, dispatches `EVENTFIRST`, initializes the full cast,
and reaches mode selection. Choose Custom Character, press Enter at the intro,
and use the actual character editor (including renaming the player). Finishing
and confirming reaches dialogue selection and then map preference. Achievement
initialization now completes with real tables and legacy-achievement checks.
The verified path enters housing setup, then stops at `VARSET MAP, "NULL"` in
the colored-map renderer (value-filling `VARSET` is not implemented), before
housing selection and the day-to-day game loop. Pre-defined-character
selection and loading existing saves are not yet supported end to end.
Unsupported operations stop with their source filename and line.
The separate conformance demo is an original ERB program exercising the supported
subset; it is not the game's title screen.

## Run

Requires Node.js 22.6+ and npm. Run from the repository root:

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000**. Set `PORT` to choose another port.

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

- **Run conformance demo**: execute a small ERB program with loops, calls,
  arithmetic, text input, single-character input (menu option 3), HTML choices, an external documentation link, and a
  real cropped title-image resource from the local game.
- **Run bundled game**: execute the real `SYSTEM_TITLE` and display its menu.
  This is the default and starts automatically on page load (including development
  reloads). The selected run mode is highlighted; clicking either run button
  starts a fresh run. While the compatibility panel is open, only its button is
  highlighted; closing it restores the current run mode's highlight.
  Invalid menu choices return to the menu; Start Game reaches custom-character
  creation, but later setup and Continue are not yet supported end to end.
- **Compatibility report**: inspect unsupported instruction names, directives,
  duplicate function/event definitions, and loader diagnostics.

The interface uses a black background, white monospace text, scrollback, keyboard
input, clickable choices, and adjustable font size. Each browser run has its own
runtime. Restarting a run resets its ordinary variables. `SAVEGLOBAL` persists
`GLOBAL`, `GLOBALS`, and header variables declared with the `GLOBAL` modifier
to the game's `.era-typescript/global.json`. This is a separate, versioned JSON
format, not Emuera's native `global.sav`; existing saves are never overwritten.
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
measure 16px, matching the interpreter's two-cell layout assumptions. This is not
MS Gothic or a pixel-identical recreation of native Emuera. The font is served
locally, with no external requests, and startup waits for it before measuring
terminal columns; font-load failure is reported rather than silently measuring a
fallback. Customize `--terminal-font` in `web/style.css` to change the font stack.

Browser snapshots are buffered: the previous completed display remains visible
while clears, HTML and image decoding are prepared off-screen, then the finished
update is committed together. Existing output nodes and their event listeners
are retained during staging; unchanged images are not reconstructed. Scroll
position is preserved unless already following the bottom or starting a new run.
Busy controls do not dim the current screen. Run buttons expose `aria-disabled`
while busy and ignore repeat activation without flashing disabled colors or
losing their hover/focus appearance. This batches each HTTP snapshot,
not every native `REDRAW` boundary; streaming and full native repaint timing are
not yet implemented.
Accepted input is echoed as plain text before the game's response (including
clicked choices and single-character input); rejected input stays editable and
does not enter the scrollback. Echoed input counts as a logical line for
`LINECOUNT` and `CLEARLINE`. `WAIT` continues without adding an input echo.
While waiting at `WAIT`, clicking the terminal also continues (in addition to
Enter or the Continue button). Links and text-selection clicks do not advance.
Each accepted input retires its output screen: earlier screens are grayscale and
dimmed, with choices disabled and links removed from keyboard/pointer interaction.
Clicked choices retain 70% brightness through
`is-selected` in history after accepted input; surrounding output stays dimmed.
This does not re-enable interaction. Typed input does not guess a matching choice.
Only the latest screen has active choices. Rejected input leaves the current
screen active. Line clearing and scrollback limits still operate on output lines
across screen boundaries, not on the screen wrappers.
Game HTML `title` descriptions (including trait `<nonbutton>` tags) appear in
immediate, multiline tooltips on hover or keyboard focus. Descriptions are plain
text, not executable HTML. Tooltip targets have a `has-tooltip` class and a subtle
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

- Recursive, deterministic ERB/ERH, ERD name-index and CSV discovery; UTF-8/BOM, UTF-16LE BOM,
  and strict Shift-JIS decoding. Source filenames and original line numbers
  survive indexing. Release-mode `[IF_DEBUG]`, `[IF_NDEBUG]`, `[ELSE]`,
  `[ENDIF]`, and `[SKIPSTART]`/`[SKIPEND]` handling.
- Macro-definedness conditionals `[IF NAME]` / `[ELSEIF NAME]` / `[ELSE]` /
  `[ENDIF]`, including nesting. Headers are loaded before ERB scripts.
  `[IF DEBUG]` tests whether a `DEBUG` macro exists; unlike `[IF_DEBUG]`, it
  does not test engine debug mode. Macro text expansion remains unsupported.
- Brace-delimited multiline statements are joined before comment processing,
  indexing, execution, and compatibility reporting. Diagnostics point to the
  first content row; quoted array values are not counted as instruction names.
- Literal `PRINT` / `PRINTFORM` arguments preserve layout whitespace after the
  single command separator, including leading, trailing and full-width spaces.
- Indexed functions and labels; ordinary `CALL`, `JUMP`, `RETURN`, `GOTO`.
  `RESTART` repeats the current routine without rebinding arguments or resetting
  locals, clearing active loop bookkeeping and retaining the instruction budget.
  Numeric parameter targets such as `ARG:0` and private declared parameter
  targets, including default expressions and legacy comma-prefixed signatures.
  `CALLF`, `CALLFORM`, `CALLFORMF`, `TRYCALLFORM` and `TRYCCALLFORM`/`CATCH`/
  `ENDCATCH` support dynamic dispatch; missing-target branches do not swallow
  errors inside existing routines. Bounded recursion shares static locals and
  creates fresh `DYNAMIC` locals. `#LOCALSIZE` and `#LOCALSSIZE` are respected.
- `RESETDATA` resets ordinary and private state while preserving globals, constants
  and title/CSV metadata. `ADDCHARA` instantiates numbered character CSV templates;
  character variables have isolated storage and omitted character indices use
  `TARGET`. `CHARADATA` header arrays and `REF` scalar/whole-array CALL parameters
  are supported. `BEGIN FIRST` unwinds the caller and dispatches `EVENTFIRST`
  routines in `#PRI`/normal/`#LATER` order, respecting `#SINGLE`.
  `_Rename.csv` substitutions are applied before script indexing.
- Character CSV queries (`EXISTCSV`, `CSVBASE`, `CSVABL`, `CSVTALENT`, `CSVEXP`,
  `CSVRELATION`, `CSVFLAG`, `CSVCSTR`, `CSVNAME`, `CSVCALLNAME`), bounded `RAND:n`,
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
- Sparse, bounds-checked numeric/string variables; one- to three-dimensional
  `#DIM`/`#DIMS`, constant initializers, ERH globals, static private variables,
  and per-call `DYNAMIC` private variables.
  Declarations initialize lazily on access. A subset of built-in arrays is
  available; the full Emuera variable catalog is not implemented.
- CSV name-to-index mappings and `*NAME` tables, plus basic GameBase metadata.
  Basic built-in array sizes come from `VariableSize.csv`; `-1` disabled arrays
  are not accessible. This game's `proto` version marker maps to the unversioned
  numeric version `0`, allowing its ERB version formatter to run. Other
  non-numeric version markers still fail explicitly.
  Character CSV templates are instantiated by `ADDCHARA`, including initial
  names, stats, flags, relationships and character strings.
- `IF`/`ELSEIF`/`ELSE`, single-instruction `SIF`, `SELECTCASE` (values,
  inclusive `TO` ranges, `IS` comparisons, default), exclusive-end `FOR`,
  `WHILE`, `DO`/`LOOP`, `REPEAT`, `BREAK`, and `CONTINUE`.
- Plain `PRINT`/`PRINTL`/`PRINTW`; `PRINTFORM`, `PRINTV`, `PRINTS` variants
  with optional `L`/`W`; basic `{integer}` and `%string%` interpolation;
  string `=` formatted assignment and `'=` expression assignment;
  numeric compound assignment and increment/decrement. Numeric `=` and string
  `'=` batch assignments advance along the final array dimension without wrapping.
- `@"..."` formatted string expressions, nested interpolation and lazy
  `\@ condition ? true text # false text \@` FORM conditionals. Comments and
  argument lists correctly handle nested quoted expressions inside FORM strings.
- `MAP_CREATE`, `MAP_RELEASE`, `MAP_SET` and `MAP_EXIST`/`MAP_SIZE`/`MAP_HAS`/
  `MAP_GET`, backed by actual runtime maps. Flat `PRINTDATA`/`PRINTDATAL`/
  `PRINTDATAW` blocks choose randomly among `DATA`/`DATAFORM` entries.
- `SPLIT`, bare-variable zero/empty `VARSET`, `STRCOUNT`, `REPLACE`,
  `SUBSTRING`, `STRLENS`, `HTML_TOPLAINTEXT`, and `HTML_POPPRINTINGSTR` support
  the game's tip-wrapping helper. HTML-to-text parsing uses parse5; popped print
  text is removed from the browser before the wrapped replacement is rendered.
- `INPUT`, `INPUTS`, `ONEINPUT`, `ONEINPUTS`, `WAIT`, `FORCEWAIT`, `PRINTBUTTON`/`PRINTBUTTONC`,
  `HTML_PRINT`, line drawing/clearing, RGB colors, alignment, `THROW`, `QUIT`.
  Output and input requests are structured events, independent of the browser.
  `FONTSTYLE` carries bold/italic/underline styles; `REDRAW 0/1` uses the existing
  snapshot buffering. Release-mode debug print instructions do not evaluate
  their arguments. `CLEARMEMORY` clears interpreter parser/compiler caches and
  requests V8 garbage collection when Node exposes it; it returns observed
  reclaimed heap bytes (possibly zero), not a promise to release native resources.
- Resource CSV sprite rectangles and local PNG/WebP/JPEG/GIF/BMP serving.
  Named `<img src='SPRITENAME'>` images are cropped from sprite sheets.
  Basic HTML paragraphs, breaks, emphasis, fonts (color only), numeric choices,
  nonbuttons and HTTP(S) links are rebuilt as allowlisted DOM nodes.
  Unitless image dimensions use percentages of the terminal font size; `px`
  dimensions are supported too. Unsupported tags and missing images show errors.
- A presentation-only patch recognizes the title's exact 35-strip HTML sequence
  and contiguous resource rectangles, rendering one cropped image instead of
  35 images and metadata requests. ERB files, runtime output and `LINECOUNT`
  remain unchanged. The browser retains 35 logical lines for `CLEARLINE`,
  including partial removal from the bottom. Incomplete/changed sequences,
  inline text, side-by-side images and other HTML use the normal renderer.
  This targeted patch lives in `src/render-patches.ts`, outside the game code.

## Deliberate limits

The compatibility inventory is **lexical**, not a playability score: recognizing
an opcode does not validate its expressions, argument forms, or reachable paths.
For example, this game uses millions of instructions, macros, game-save loading,
character-management operations, additional engine lifecycle transitions, drawing
APIs, and extensions that are not implemented yet.

Not supported: native Emuera saves and game-slot persistence, `BEGIN` states other
than `FIRST`, full character-management APIs, general random APIs, other event
dispatch or overloaded functions, general macro expansion and replace tables,
REF expression-function arguments, the full configuration and
variable-size rules, graphics/audio APIs, arbitrary HTML/CSS, resource animations,
or exact Emuera layout/line-measurement semantics. `MAXWIDTH()` uses terminal
columns measured at browser run start (default 120 in direct/API runs); restart
the run after resizing or changing font size. `STRLENS`/`SUBSTRING` approximate
legacy display width, not every CP932 encoding edge case. Regex helpers use
JavaScript regex syntax, not all .NET regex extensions. Only argument-free flat
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

Bundled-game execution is bounded to 1,000,000 instructions between input requests
to accommodate its real class/item/cast initialization (validated within that
budget). Direct runtimes and the demo default to 50,000. All runs retain a 2 MB
output limit between input
requests, 128 call frames, 16 KB request bodies, and eight active sessions
(30-minute idle expiry). This is a **local development tool**, not a hosted
multi-user service or a sandbox for untrusted games. It listens only on loopback,
checks Host/Origin, uses a CSP, and prevents resource traversal (including
symlinks). No game-supplied scripts or event attributes are attached to the DOM.

## Layout and next compatibility work

- `src/loader.ts`: script/data/resource indexing and encoding.
- `src/expression.ts`, `src/variables.ts`: expression and variable semantics.
- `src/format.ts`, `src/strings.ts`, `src/html.ts`: FORM and text parsing.
- `src/storage.ts`: memory/file global storage adapters.
- `src/data-tables.ts`: session-local typed data-table storage and lookups.
- `src/compiler.ts`, `src/runtime.ts`: control-flow compilation and execution.
- `src/compatibility.ts`: unsupported-feature inventory.
- `src/server.ts`: HTTP/session/resource adapter.
- `web/`: terminal renderer and input client.
- `test/`: conformance, HTTP, loader and bundled-game regression tests.

Next work should follow the verified new-game path into housing's colored-map
renderer, then housing/options and the `BEGIN SHOP` game loop.
Pre-defined character selection needs additional character-management operations;
Continue needs native save-format/slot handling.
Keep unsupported behavior explicit and add conformance tests for each feature
before claiming more of the game is supported.

Language references: [Emuera wiki](https://wiki.eragames.rip/index.php/Emuera),
[ERB format](https://wiki.eragames.rip/index.php/Emuera/eramaerb),
[operators](https://wiki.eragames.rip/index.php/Emuera/exop),
[user variables](https://wiki.eragames.rip/index.php/Emuera/UserVars),
[HTML output](https://wiki.eragames.rip/index.php/Emuera/exhtml).
