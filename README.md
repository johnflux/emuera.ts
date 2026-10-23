# TypeScript Emuera

A Node.js interpreter foundation for Emuera/eramaker ERB, with a browser terminal.
The local game directory `anon-tw-anon-tw_eng-modding` is the default target.
Game scripts, data, and images are read in place and are not bundled or copied.

**The real title menu renders and waits for numeric input. Gameplay is not yet
supported.** The unmodified `@SYSTEM_TITLE` executes its startup calls, builds
the talent maps, renders all 35 title-image strips, displays version information
and a random tip, and reaches `INPUT`. Starting a new game or loading an existing
save still encounters unsupported engine features; neither path is advertised
as playable. Unsupported operations stop with their source filename and line.
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
  Invalid menu choices return to the menu; Start Game and Continue are not yet
  supported end to end.
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
Accepted input is echoed as plain text before the game's response (including
clicked choices and single-character input); rejected input stays editable and
does not enter the scrollback. Echoed input counts as a logical line for
`LINECOUNT` and `CLEARLINE`. `WAIT` continues without adding an input echo.

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

- Recursive, deterministic ERB/ERH and CSV discovery; UTF-8/BOM, UTF-16LE BOM,
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
- Indexed functions and labels; ordinary `CALL`, `JUMP`, `RETURN`, `GOTO`.
  Numeric parameter targets such as `ARG:0` and private declared parameter
  targets, including default expressions.
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
  CSV character files are indexed as data but not instantiated as characters.
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
characters, engine lifecycle transitions, drawing APIs, and extensions that are
not implemented yet.

Not supported: native Emuera saves and game-slot persistence, `BEGIN` lifecycle
dispatch, character state, general random APIs, event dispatch or overloaded
functions, macro expansion/rename/replace tables,
reference/character declarations, the full configuration and
variable-size rules, graphics/audio APIs, arbitrary HTML/CSS, resource animations,
or exact Emuera layout/line-measurement semantics. `MAXWIDTH()` uses terminal
columns measured at browser run start (default 120 in direct/API runs); restart
the run after resizing or changing font size. `STRLENS`/`SUBSTRING` approximate
legacy display width, not every CP932 encoding edge case. Regex helpers use
JavaScript regex syntax, not all .NET regex extensions. Only argument-free flat
print-data blocks, basic FORM interpolation, and zero-padded `TOSTR` formatting
are supported; more complex forms still fail explicitly. Recursive calls are
rejected until their parameter/local behavior is implemented and tested.

The first unsupported instruction on an executed path stops that runtime.
Malformed function signatures are diagnosed during indexing and rejected if
called. Unsupported directives remain visible in the inventory. Function-local
unsupported directives stop execution when entering that function.

Execution is bounded to 50,000 instructions and 2 MB of output between input
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
- `src/compiler.ts`, `src/runtime.ts`: control-flow compilation and execution.
- `src/compatibility.ts`: unsupported-feature inventory.
- `src/server.ts`: HTTP/session/resource adapter.
- `web/`: terminal renderer and input client.
- `test/`: conformance, HTTP, loader and bundled-game regression tests.

Next work should follow the menu's actual branches: implement `RESETDATA`,
character templates/state and `BEGIN FIRST` lifecycle dispatch for Start Game,
and native save-format/slot handling for Continue.
Keep unsupported behavior explicit and add conformance tests for each feature
before claiming the title menu or the game is supported.

Language references: [Emuera wiki](https://wiki.eragames.rip/index.php/Emuera),
[ERB format](https://wiki.eragames.rip/index.php/Emuera/eramaerb),
[operators](https://wiki.eragames.rip/index.php/Emuera/exop),
[user variables](https://wiki.eragames.rip/index.php/Emuera/UserVars),
[HTML output](https://wiki.eragames.rip/index.php/Emuera/exhtml).
