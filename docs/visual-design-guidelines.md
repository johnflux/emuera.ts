# Visual Design Guidelines

This document is the project's **visual design system**: a shared visual
language for the app, its game-specific interface enhancements, and new artwork.
There is no single industry-wide set of correct fonts, colors, or spacing values.
These guidelines establish a consistent direction using common design-system
practices such as reusable tokens, clear hierarchy, responsive layouts, and
accessible contrast.

The current UI has two intentionally different surfaces:

- **App chrome and library:** a quiet, contemporary dark interface with
  restrained sage and warm-neutral accents.
- **Game output:** a familiar Emuera terminal, primarily monospace on black,
  with game text and configuration remaining authoritative.

Treat these as related parts of one product, not as one surface that must look
identical everywhere. The library can feel polished and welcoming; in-game
enhancements can be more expressive, but should not make the underlying game
harder to read or use.

## Design principles

1. **Readable first.** Text, choices, and status should be easy to scan before
   decoration is added.
2. **Use hierarchy, not noise.** Distinguish headings, supporting details,
   actions, and status through consistent size, weight, spacing, and color.
3. **Keep the game recognizable.** Preserve the terminal's dense, fixed-width
   character and the game's own text colors and settings. Style added panels
   around that output rather than imposing the library's look on it.
4. **Be consistent across screens.** Reuse the same color roles, spacing steps,
   control shapes, and interaction states instead of inventing new ones per
   component.
5. **Make every layout adapt.** A design must work with narrow windows,
   compact screens, keyboard navigation, and controller input as well as a
   desktop mouse.

## Typography

### Choose type by surface

- Use the configured monospace terminal font for game output and controls that
  are part of the terminal. The current default is BIZ UD Gothic at 16px.
- Use the system sans-serif stack for app chrome, the library, and standalone
  dialogs. It is the existing library convention and gives those surfaces a
  clear separation from game text.
- Use a display or serif face only for a deliberate, limited piece of artwork
  or a single decorative detail. Do not introduce it as a third general-purpose
  interface font.
- Prefer bundled or system fonts; do not add a remote font dependency for
  ordinary interface text.

### Establish hierarchy

Use these as starting points, not rigid per-component requirements:

| Role | Starting size | Guidance |
|---|---:|---|
| Fine print / metadata | 10–12px | Secondary, brief information only |
| Supporting text | 12–14px | Descriptions, labels, and helper copy |
| Body / game output | 16px | Default reading size; terminal line-height is about 1.25 |
| Section heading | 18–20px | Dialog sections and card titles |
| Page heading | 36–56px | Library or other page-level editorial heading |

Use weight and spacing before adding more font sizes. Keep body copy near a
1.5–1.7 line-height on sans-serif surfaces; compact terminal output can retain
its tighter line-height. Avoid shrinking essential text to fit: reflow, wrap, or
remove nonessential decoration instead.

## Color

Use color by **role**, not as a one-off flourish. The following palette records
the current direction and useful reference values; many existing styles still
contain local values, so these are not all centralized CSS variables yet.

| Role | Reference | Use |
|---|---|---|
| App canvas | `#10141b` | Library and home background |
| App panel | `#181e28` | Cards and contained surfaces |
| App primary text | `#e9edf4` | Main labels and headings |
| App secondary text | `#9ba7b8` | Descriptions and supporting details |
| Sage accent | `#98c8bc` | Selected tabs, primary actions, and calm emphasis |
| Warm accent | `#d6bd8a` | Small editorial or decorative highlights |
| Terminal canvas | `#000000` | Default game output background |
| Terminal text | `#c0c0c0` | Default game output foreground |
| Terminal selection | `#ffff00` | Existing game-choice selection color |
| App focus / link accent | `#8ddaff` | Keyboard focus and app links |

Keep the terminal palette distinct from the library palette. Do not recolor
game-authored output or override a player's configured terminal colors merely
to match an app-wide theme.

Use semantic states consistently: green/sage for ready or positive states,
amber for caution or slow progress, and red for destructive or error states.
Never communicate a state by color alone; pair it with a label, icon, or other
visible cue. Reserve saturated colors and gradients for a small number of
high-priority elements.

For text, target WCAG 2.2 AA contrast: at least 4.5:1 for normal-sized text and
3:1 for large text. Important control boundaries and focus indicators should
also remain clearly visible against adjacent colors. Check contrast after
opacity, overlays, gradients, and hover effects are applied, not just for the
base hex values.

## Layout, spacing, and controls

App and library button appearance lives in `styles/shared/_chrome-buttons.scss`.
Add `ui-button` and explicit variant classes when constructing each control;
containers may arrange buttons but must not supply their colors, typography,
borders, padding, or interaction states. Use one shared 13px sans-serif label
font and weight, including small/large buttons; size variants change padding
and hit area, not typography. The only appearance variants are primary, quiet,
danger, small, large, tab, menu-item, and icon. Library and history tabs both use
`ui-button--tab`; tab counts use its child span. Menu buttons and navigation
links both use `ui-button--menu-item`. Saves and sends use primary; cancels and
closes use quiet; secondary tools use default or quiet with small when needed.
Do not introduce screen-specific variants such as library, history, settings,
LLM, or controller buttons. Controller menus use large, and all chrome buttons
have a minimum 44px touch target on compact coarse-pointer screens. Selected,
expanded, busy, disabled, focus, and controller-hint states are shared.
`ui-button--continue` only adds the existing pause-hint animation; it does not
change button appearance. New variants require a root-button fixture in
`web/chrome-button-samples.js` (`CHROME_BUTTON_SAMPLES`) so the component catalog
can demonstrate them without app ancestors, including disabled states.
`test/chrome-buttons.test.ts` checks selector-state fixture coverage and compares
normal, focused, and disabled appearances inside and outside app containers,
including production button class combinations. It also enforces shared label
typography and tab/link equivalence.
Place overlays with their containers; do not absolutely position a button
variant merely to place it in one screen.
Controller decorations also belong to the control: chrome uses its local
`has-controller` state; game controls use `has-controller-hint` and
`controller-focus`, maintained by `syncGameControllerHints` and focus events.
Game Y/X/B hints live in `styles/game/_button-variants.scss`, not dialog or
screen-parent selectors.
Game button variants and states also require fixtures in `src/button-samples.ts`.
`test/button-system.test.ts` checks coverage and prohibits panel-level appearance
rules; `test/components-browser.test.ts` verifies real-renderer parent independence
and content-sized, left-aligned map controls.
Native printed choices retain the game's inline grouping and explicit newlines,
including inside settings dialogs. Full-width rows must explicitly request the
`list` or `block` component variant; do not infer them from the containing screen
or from a choice being alone on a line.
Use browser zoom for interface sizing; there is no font-size setting or
handheld-mode styling switch. Responsive layouts
and controller navigation remain automatic. Controller mode hides the command
line; controller hints hide command numbers regardless of viewport size. The
catalog's sticky state bar toggles disabled controls and controller mode without
changing saved game preferences.

- Align content to a clear container or grid. The library's existing centered
  content width of about 1160px is a good starting point for similar pages.
- Use a repeatable spacing scale: **4, 8, 12, 16, 24, 32, 48px**. Prefer these
  steps for gaps and padding; use intermediate values only when the layout or
  terminal's character grid requires them.
- Group related information closely and leave larger gaps between sections.
  Keep card padding and grid gaps consistent within the same view.
  Game action groups, toggles, and adjacent inline command tiles share
  `--era-actions-gap` (6px); avoid screen-specific spacing overrides.
  Use `.era-actions-collection` to arrange multiple `.era-actions-group`
  sections side by side with wrapping; screen-specific grid placement belongs
  to the containing screen, not the collection.
  Reuse `.era-actions-panel` for compact collections of action groups, optional
  auto-toggles, and settings. Within its groups, the first two printed tiles in
  each line share a row and subsequent tiles are full-width. The player screen's
  bottom anchoring is separate from this reusable panel layout.
- Use compact 4–6px radii for controls and smaller elements; use 8–12px for
  cards and larger panels. Avoid mixing rounded pills, sharp corners, and
  decorative frames without a clear hierarchy.
- Prefer a small number of aligned columns over individually positioned labels.
  For data-heavy terminal additions, align to character widths (`ch`) where
  appropriate so columns remain legible in monospace.
- Keep actions beside the content they affect. Put a clear primary action first,
  and keep destructive actions visually distinct and away from accidental
  activation.
- Keep desktop game choices compact, but make compact-viewport chrome controls at least
  44px high where practical. Do not rely on hover for essential feedback.
- On narrow screens, reflow grids and dialog content before allowing horizontal
  overflow. Let long game names and user-provided text wrap safely.

## Interaction and accessibility

- Provide a visible `:focus-visible` treatment for every keyboard-operable
  control. Do not remove the outline unless an equally visible replacement is
  provided.
- Use the same visual language for enabled, disabled, selected, focused, and
  busy states across related controls. Disabled controls must remain
  understandable and distinguishable. Use native `disabled` on buttons, preserve
  game-authored `aria-disabled`, and exclude both from hover/focus decoration.
  Disabled is a state of an existing component, not another visual variant.
- Pair icon-only controls with an accessible name. Use text labels for
  important actions and status wherever possible.
- Respect `prefers-reduced-motion`. Motion should explain a state change, not
  obstruct reading or delay input.
- Do not use decorative images or animation behind text when they reduce
  contrast or obscure game output.

## Art direction

- Keep the app's non-game interface atmospheric but restrained: dark blue-gray
  surfaces, muted sage, and occasional warm-neutral highlights are the baseline.
- Give a screen one clear focal point. Use a single strong image or treatment
  rather than several competing gradients, glows, borders, and ornaments.
- In game-specific enhancements, let each game's subject and existing artwork
  guide its accent colors. Keep shared controls, text hierarchy, and layout
  behavior consistent even when a panel has a distinct theme.
- Use ornament—floral corners, ribbons, frames, decorative lettering—as an
  accent for a fitting thematic moment, not as a default on every panel.
- Keep decorative artwork separate from controls and content. Avoid placing
  text inside artwork unless it remains crisp, scalable, and accessible at all
  supported sizes.
- Prefer assets that work on dark backgrounds, have clean edges at their
  rendered size, and do not depend on subtle color differences alone.

## Implementation guidance

- Before adding a new style, check the shared foundations in
  `styles/shared/_base.scss`, `styles/shared/_terminal.scss`, and the relevant
  library or game styles for an existing pattern.
- Do not create variants for tiny padding/margin differences or semantic names.
  Actions and sidebar commands share `.era-button`; `.era-button-block` only
  changes layout. Put command numbers and optional suffixes in data attributes
  and let the frontend render their decorative presentation.
- Reuse existing CSS custom properties such as `--terminal-foreground`,
  `--terminal-background`, `--selection-color`, and the `--button-*` properties.
  For repeated new values, introduce a shared token in the appropriate
  foundation instead of copying slightly different literals across components.
- Scope styles to the surface or component they belong to. Avoid broad global
  rules that unexpectedly change game output, third-party game content, or
  unrelated dialogs.
- Test new layouts at desktop and compact widths, and check keyboard focus,
  reduced motion, long labels, and configured terminal colors.

## Design review checklist

Before calling a UI or artwork change complete, check:

- Is its purpose and reading order immediately clear?
- Does it use the right typeface and a consistent text hierarchy for its
  surface?
- Are spacing, alignment, colors, and control shapes reused rather than
  improvised?
- Does all text meet the contrast target, including states and overlays?
- Does it preserve the game's own output and player settings?
- Does it adapt to compact widths and keyboard/controller input?
- Are decorative effects restrained, useful, and reduced-motion friendly?
