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
  friendship introduction (0 = never accepted, 1 = friends, -1 = lapsed).
  Lapsed friendship retains the one-time bonus history.
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
