# TypeScript Emuera

A Node.js interpreter foundation for Emuera/eramaker ERB, with a browser terminal.
The local game directory `anon-tw-anon-tw_eng-modding` is the default target.
Game scripts, data, and images are read in place and are not bundled or copied.

**This is not yet a playable implementation of the bundled game.** The real
`@SYSTEM_TITLE` is invoked, but execution stops with a source-located error at
`LOADGLOBAL` (currently `ERB/TITLE.ERB:5`). Nothing silently substitutes for it.
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
  arithmetic, text input, HTML choices, an external documentation link, and a
  real cropped title-image resource from the local game.
- **Run bundled game**: attempt the actual `SYSTEM_TITLE`; display the first
  unsupported operation with its ERB filename and line number.
- **Compatibility report**: inspect unsupported instruction names, directives,
  duplicate function/event definitions, and loader diagnostics.

The interface uses a black background, white monospace text, scrollback, keyboard
input, clickable choices, and adjustable font size. Each browser run has its own
runtime. Restarting a run resets its memory; nothing is persisted.

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
- A parsed expression AST, never JavaScript `eval`. Signed 64-bit integer
  arithmetic, comparisons, bitwise operators, short-circuit logical operators,
  `? ... # ...` conditionals, strings, array access, and selected built-ins
  (`ABS`, `MIN`, `MAX`, `LIMIT`, `TOSTR`, `TOINT`, `STRLENU`, `MAXWIDTH`).
  Bare array indices bind tightly; parenthesize computed indices.
- Sparse, bounds-checked numeric/string variables; one- to three-dimensional
  `#DIM`/`#DIMS`, constant initializers, ERH globals and static private variables.
  Declarations initialize lazily on access. A subset of built-in arrays is
  available; the full Emuera variable catalog is not implemented.
- CSV name-to-index mappings and `*NAME` tables, plus basic GameBase metadata.
  CSV character files are indexed as data but not instantiated as characters.
- `IF`/`ELSEIF`/`ELSE`, single-instruction `SIF`, `SELECTCASE` (values,
  inclusive `TO` ranges, `IS` comparisons, default), exclusive-end `FOR`,
  `WHILE`, `DO`/`LOOP`, `REPEAT`, `BREAK`, and `CONTINUE`.
- Plain `PRINT`/`PRINTL`/`PRINTW`; `PRINTFORM`, `PRINTV`, `PRINTS` variants
  with optional `L`/`W`; basic `{integer}` and `%string%` interpolation;
  string `=` formatted assignment and `'=` expression assignment;
  numeric compound assignment and increment/decrement. Numeric `=` and string
  `'=` batch assignments advance along the final array dimension without wrapping.
- `INPUT`, `INPUTS`, `WAIT`, `FORCEWAIT`, `PRINTBUTTON`/`PRINTBUTTONC`,
  `HTML_PRINT`, line drawing/clearing, RGB colors, alignment, `THROW`, `QUIT`.
  Output and input requests are structured events, independent of the browser.
- Resource CSV sprite rectangles and local PNG/WebP/JPEG/GIF/BMP serving.
  Named `<img src='SPRITENAME'>` images are cropped from sprite sheets.
  Basic HTML paragraphs, breaks, emphasis, fonts (color only), numeric choices,
  nonbuttons and HTTP(S) links are rebuilt as allowlisted DOM nodes.
  Unitless image dimensions use percentages of the terminal font size; `px`
  dimensions are supported too. Unsupported tags and missing images show errors.

## Deliberate limits

The compatibility inventory is **lexical**, not a playability score: recognizing
an opcode does not validate its expressions, argument forms, or reachable paths.
For example, this game uses millions of instructions, user-defined expression
functions, macros, save/load, characters, engine lifecycle transitions, drawing
APIs, and extensions that are not implemented yet.

Not supported: saves/global persistence, `BEGIN` lifecycle dispatch, character
state, random APIs, user-defined expression functions/`RETURNF`, event dispatch
or overloaded functions, macro expansion/rename/replace tables,
reference/dynamic/character declarations, the full configuration and
variable-size rules, graphics/audio APIs, arbitrary HTML/CSS, resource animations,
or exact Emuera layout/line-measurement semantics. `MAXWIDTH()` is currently a
fixed logical width of 120, not the browser's measured width. Non-numeric
GameBase versions fail explicitly on access. Recursive calls are rejected until
their parameter/local behavior is implemented and tested.

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
- `src/compiler.ts`, `src/runtime.ts`: control-flow compilation and execution.
- `src/compatibility.ts`: unsupported-feature inventory.
- `src/server.ts`: HTTP/session/resource adapter.
- `web/`: terminal renderer and input client.
- `test/`: conformance, HTTP, loader and bundled-game regression tests.

Next work should follow actual startup blockers: implement global persistence
with explicit storage semantics, memory reset, missing variable/config rules,
and user-defined expression functions, then the title's custom function calls.
Keep unsupported behavior explicit and add conformance tests for each feature
before claiming the title menu or the game is supported.

Language references: [Emuera wiki](https://wiki.eragames.rip/index.php/Emuera),
[ERB format](https://wiki.eragames.rip/index.php/Emuera/eramaerb),
[operators](https://wiki.eragames.rip/index.php/Emuera/exop),
[user variables](https://wiki.eragames.rip/index.php/Emuera/UserVars),
[HTML output](https://wiki.eragames.rip/index.php/Emuera/exhtml).
