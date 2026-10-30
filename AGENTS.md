# Save compatibility

- Preserve compatibility with standard Emuera `.sav` files in both directions.
  Never change the native save layout, version, or existing variable meanings
  for browser-only features.
- Game-specific state may use verified-unused slots inside existing saved
  arrays without resizing them. Document reservations and check numeric,
  named, computed-index and bulk-reset uses before allocating slots.
- eraTW reserves per-character CFLAG 7395 / 7396 / 7397 for pending frozen-time
  V / A / M penetration aftereffects (0 = absent, 1 = pending).
- Test native save/load round trips and existing saves when changing persistence.
  Do not move game-state flags into sidecars.
