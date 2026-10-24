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

## Patches

| File | Replaces | Change |
|------|----------|--------|
| `INFO_PALAM.ERB` | `@SHOW_INFO_PALAM` | Palam as a wrapping grid: short name, level, meter, abbreviated value (`23.4k`) and gain. Zero values are dimmed and the highlighted Palams use the game's yellow. The tooltip shows the full name, value, next level threshold and gems. The collapse toggle and the bars/numbers toggle are dropped. |
