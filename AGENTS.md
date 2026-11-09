# UI copy

- Keep game and demo interfaces concise and in the game's style. Do not add
  unsolicited disclaimers, explanatory paragraphs or reassurance such as
  "Preview only", "No changes until you confirm" or instructions describing
  obvious controls. Prefer clear labels; put implementation details in docs.
- Preserve actionable error messages and reasons an option is unavailable.

# Save compatibility

- Preserve compatibility with standard Emuera `.sav` files in both directions.
  Never change the native save layout, version, or existing variable meanings
  for browser-only features.
- Game-specific state may use verified-unused slots inside existing saved
  arrays without resizing them. Document reservations and check numeric,
  named, computed-index and bulk-reset uses before allocating slots.
- eraTW reserves per-character CFLAG 7395 / 7396 / 7397 for pending frozen-time
  V / A / M penetration aftereffects (0 = absent, 1 = pending).
- eraTW reserves per-character CFLAG 7398 for formal commitment and 7399 for
  friendship bonus HISTORY ONLY (0 = not received, any nonzero value = received).
  Never use 7399 to determine current friendship: that depends only on favor
  >= 500. Falling favor or hate marks must never clear the bonus history.
- Test native save/load round trips and existing saves when changing persistence.
  Do not move game-state flags into sidecars.

# Browser renderer protocol

- The browser HTML/output protocol is internal, not a compatibility contract.
  There is no need to preserve forward or backward compatibility with older
  renderer versions when changing it; update producers, the renderer and related
  tests together.
- Extend supported HTML tags or output structures when needed for good UI,
  rather than working around the renderer's current limitations. Keep rendering
  safe and errors explicit.
- This does not relax the native Emuera save-compatibility requirements above.

# Shared components

- Before adding or restyling a screen control, check `/components` and existing
  shared components for something reusable.
- Prefer common components over one-off screen controls, and convert existing
  bespoke controls when touching them. Add component variants to the shared
  component rather than duplicating their markup or behavior in screens.
- Component styles own their appearance and interaction states. Screens may
  arrange and size components, but must not restyle or override their visual
  treatment.
- Keep the component catalog and relevant tests in sync when adding or changing
  a shared component.

# Native Emuera spot checks (Wine)

- For behavior parity questions, prefer a direct run of native Emuera before
  changing runtime semantics.
- In this repo, the known binary path is
  `GAMES/anon-tw-anon-tw_eng-modding/Emuera.exe`.
- Make a throwaway folder with empty `CSV/`, an `ERB/` containing one test
  script, and a copy of the executable. Do not modify an installed game.
- Write the script under `@SYSTEM_TITLE`, use `OUTPUTLOG` before and after each
  probe, and end with `PRINTL DONE`, `OUTPUTLOG`, and `QUIT`. Check
  `emuera.log`, including errors, rather than relying on Wine's console output.
- Set `システム関数の上書きを許可する:YES` in `emuera.config`, then launch
  Wine from the throwaway folder:
  `WINEDEBUG=-all wine ./Emuera.exe`
- Parenthesize negative pseudo-variable indices, for example `RAND:(-5)`.
  Test `CompatiRAND` separately: default mode rejects non-positive bounds;
  eraMaker compatibility mode accepts them.
- Stop the Wine process after inspecting the log and remove temporary files.
  See `docs/developer-guide.md` for the existing native fixture procedure.
