# Emuera.ts: bringing an ERB game engine to Node.js and the browser

*A project overview of the language, the interpreter, and the little details that make compatibility interesting.*

Emuera.ts runs real Emuera/eramaker games in a browser, with a TypeScript interpreter on a Node.js backend. It loads the games' ERB scripts, CSV data, and image resources from disk, executes the scripts, and presents the result in a browser-based terminal.

The aim is not to translate a game into a new format or to replace its scripts with a mock-up. The interpreter runs the original ERB program. That makes the project both a language implementation and a practical compatibility effort: the engine has to reproduce the behavior that existing games expect, including the quirks that are easy to miss when looking at the syntax alone.

## What is ERB?

In this project, “ERB” means the script files used by the Emuera/eramaker game ecosystem—not Ruby's ERB templating format. It is a domain-specific language for interactive games. Scripts are organized into named routines, typically introduced with `@`, and use instructions such as `CALL`, `IF`, `SELECTCASE`, `FOR`, `INPUT`, and `PRINTL`. Game state lives in engine-defined variables and arrays; much of the game's content and metadata comes from CSV files.

ERB programs mix several kinds of work in the same script: game rules, dialogue, menus, user input, formatting, and presentation commands. A line such as `PRINTFORML You found {ITEMNAME}.` can evaluate an expression and add formatted text to the terminal; later instructions may pause for input, then continue the same routine with the player's answer.

That close connection between language and engine is part of the appeal. A game is not merely a collection of text files: the runtime's variable rules, input behavior, text measurement, CSV conventions, and output timing all contribute to what the player sees.

## How we run it

The backend is a Node.js process written in TypeScript. At startup it discovers installed games, loads their ERB routines and CSV data, indexes sprites and other metadata, and reports useful compatibility diagnostics. The game files stay in their directories; the project does not bundle or convert them.

The HTTP server offers the browser UI and a small JSON API. When a player starts a run, the server creates a runtime for that game and keeps the live session on the server. The browser submits choices or typed input to endpoints such as `/api/input`; the runtime resumes from its wait point and returns the next snapshot. A run can therefore pause at an `INPUT` or `WAIT`, return control to the browser, and pick up again when the player acts.

For development, `npm start` runs the TypeScript server with `tsx` and watches the frontend and game files. For a production-style run, `npm run build` compiles TypeScript and `npm run start:prod` starts the compiled server. The browser interface is served locally, usually at `http://127.0.0.1:3000`.

The bundled conformance demo is useful here: it is itself a small ERB program, not a second hand-coded interpreter or a static showcase. It exercises the same runtime with loops, calls, text and single-character input, click-to-continue dialogue, HTML, sprites, and `PRINTC` menus.

## From print instruction to browser line

The runtime does not ask the browser to understand ERB. Instead, it turns script output into a small, typed display protocol. As the interpreter executes commands such as `PRINT`, `PRINTL`, `PRINTW`, `PRINTFORM`, `PRINTC`, and `HTML_PRINT`, it emits structured output items: text with style and newline information, HTML, buttons, input prompts, or clear-line operations.

Those items are collected into a runtime snapshot when the script reaches an input or wait point. The server returns the snapshot as JSON, and the browser renderer turns each item into terminal content. Plain text is inserted as text, HTML goes through the HTML renderer, button choices become interactive controls, and clear operations update the existing display. The browser then sends the player's action back to the server so the ERB program can continue.

So there are two related—but distinct—sets of “print commands” to keep straight:

1. **The game-facing commands** are the Emuera/ERB print family understood by the interpreter. They retain their individual semantics; for example, a line-ending variant and a wait-after-print variant do different things.
2. **The runtime-to-browser output items** are our internal protocol for representing what those commands produced. They let the browser render text, formatting, interactive choices, and other display operations without interpreting ERB itself.

That boundary is what makes a web UI possible without rewriting the game. It also means details like “the line is still open,” “this command ends the line,” “this text has a different color,” or “the script is waiting now” have to survive all the way from interpreter to renderer. At a wait point, the runtime flushes any unfinished text line, just as Emuera does before handing control to the player.

The output protocol can also carry HTML and sprite metadata. That supports menus and images while keeping normal game text separate from markup. The browser can redraw or clear existing lines, render a row of `PRINTC` items as whole clickable cells, and display sprites from the game's own resources.

## How big is the language—and the game we're testing against?

ERB is a compact, game-specific language rather than a general-purpose language with one standardized feature count. The useful measure for this project is the size of a real game and the amount of its language surface we have to execute.

In the bundled eraToho The World checkout, the current compatibility inventory counts approximately:

- **3,490 ERB script files**
- **92,807 routine definitions**
- **2,097,148 instruction lines**
- **194 CSV tables**
- **21,812 sprite definitions**

The instruction inventory currently recognizes every instruction *name* it encounters. That is a useful sign that the parser knows the vocabulary of this particular game, but it is not a claim that every instruction argument, expression, variable, preprocessor feature, or reachable gameplay path is fully compatible. In other words, “all names recognized” is not “the whole game is playable.” The compatibility report is deliberately a lexical inventory, not a playability percentage.

For scale, one representative “Wake up” flow in the project involves about **580,000 ERB lines**. This kind of workload is why the implementation includes compiled routines, carefully scoped caches, and a JIT path for frequently called code. The JIT remains an optimization: unsupported constructs fall back to interpreter execution, and tests compare compiled results with interpreter results.

Today, the documented verified path reaches the real title screen, performs real custom-character creation, and proceeds through setup to the pre-game settings menu. Full day-to-day gameplay is not yet supported end to end. Unsupported operations stop with a source filename and line number instead of pretending that execution succeeded.

## The gotchas are where compatibility lives

The syntax is only the beginning. A lot of the work is matching the small behavioral rules that games rely on:

- **A space after `PRINT` is not just decoration.** The command separator is consumed, but later spaces belong to the output. Leading and trailing layout whitespace—including full-width spaces—can align maps and menus, so trimming it would visibly break a screen.
- **“Print” does not always mean the same boundary.** Some variants append to the current line, some end it, and some wait for a click after printing. Pending text must be flushed at input and wait boundaries, and output after a click-to-continue wait has its own screen behavior.
- **Text width follows the old engine, not the browser's Unicode columns.** Emuera-compatible alignment uses a Shift-JIS/CP932 byte-width model: many Japanese characters count as two cells, half-width kana as one, and some characters CP932 cannot encode also count as one. Browser string length is not a substitute.
- **The language has fixed-width integer behavior.** Numeric expressions use signed 64-bit arithmetic, including wraparound at the bounds. JavaScript's ordinary `number` type cannot represent every integer exactly, so the runtime uses `bigint` and applies the engine's range rules.
- **Similar-looking conditionals can mean different things.** `[IF_DEBUG]` selects by engine debug mode, while `[IF DEBUG]` tests whether a macro named `DEBUG` is defined. Treating them as interchangeable changes which script lines exist.
- **`FORM` is a formatting language inside the language.** It interpolates values and handles padding; literal `PRINT` text does not. The parser also has to distinguish expressions from commas, quoted strings, comments, and nested syntax without relying on JavaScript `eval`.
- **Arrays and calls have engine-specific rules.** Omitted character indices can refer to `TARGET`; `REF` parameters bind whole arrays rather than just the indexed element; and default or omitted call arguments must preserve their intended positions. A convenient generic-language interpretation is often the wrong one.
- **Input is a suspension point, not a normal function return.** An ERB routine may need to pause deep in a chain of calls and resume later. Expression functions, by contrast, are not allowed to request input. The interpreter and JIT need to preserve that distinction.
- **Data conventions are part of the runtime contract.** CSV fields, legacy encodings, name-to-index mappings, event ordering, private/static variables, and save behavior all influence whether a real game starts correctly.

These are not exotic corner cases added for a test suite. They are the accumulated assumptions of a large body of existing game scripts. We make them explicit in the interpreter and regression tests so that optimizations, browser rendering, and future compatibility work do not quietly change what the original game means.

## Why it is interesting

Emuera.ts sits at an unusual intersection: a legacy scripting ecosystem, a real-world interpreter, a browser renderer, and a Node.js server. That gives us a useful feedback loop. We can run actual game code, inspect what it prints, compare the result with Emuera's behavior, and fix a language rule or presentation detail at its source.

It is also a reminder that language implementations are made of edge cases as much as grammar. A few `PRINT` commands can stand between an invisible layout space and a correctly aligned Japanese menu; an input wait can define where the runtime snapshot ends; and a single signed-integer overflow rule can decide whether a complex new-game setup reaches the next screen.

The project is still a work in progress, but the core idea is already tangible: let the original ERB scripts run on a modern TypeScript/Node.js backend, then carry their output faithfully into a browser—one structured display event at a time.
