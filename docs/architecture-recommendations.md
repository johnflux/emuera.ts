# Architecture and technical-debt review

Review date: 2026-11-08

This review is based on the repository structure, implementation entry points,
project documentation, and existing tests. It is an architectural assessment,
not a line-by-line correctness or security audit. Recommendations favor
incremental extraction and preserving behavior over replacing working systems.

## Current shape

```text
Game ERB/CSV files
  -> loader and game index
  -> lazy instruction compiler and interpreter
  -> HTTP API, runtime sessions, and snapshots
  -> browser terminal and feature modules
  -> optional Electron host around the local server
```

- [`src/loader.ts`](../src/loader.ts) discovers game folders, reads and indexes
  scripts and data, applies hotpatches, and builds the `Game` aggregate.
- [`src/compiler.ts`](../src/compiler.ts), [`src/expression.ts`](../src/expression.ts),
  [`src/statement-parser.ts`](../src/statement-parser.ts), and
  [`src/variables.ts`](../src/variables.ts) implement language parsing,
  compilation, evaluation, and variable semantics.
- [`src/runtime.ts`](../src/runtime.ts) is the central interpreter and
  application-runtime boundary. It also owns output snapshots, graphics,
  persistence and suspend operations, JIT integration, and TW-specific
  interaction features.
- [`src/server.ts`](../src/server.ts) composes the application: HTTP routes,
  sessions and replay history, game loading, static/resource serving, library
  operations, and save coordination.
- [`web/app.js`](../web/app.js) coordinates the browser run lifecycle and UI;
  focused features are already factored into sibling ES modules.
- [`electron/main.cjs`](../electron/main.cjs) is a comparatively thin desktop
  host that starts the local server and opens a sandboxed browser window.

There are good foundations to build on: TypeScript is configured strictly;
the tests cover interpreter behavior, save compatibility, HTTP behavior, and
browser features; and the developer guide records deliberate compatibility
limits and native-engine checks. The most visible product risk is inconsistent
UI styling: styles are organized mostly by feature/screen, while the browser
markup has many standalone controls and dialogs. The largest code-structure
risks are concentration of responsibilities at the runtime, server, and
browser orchestration layers.

## Prioritized recommendations

### 1. Establish one UI system and a live component catalog

**Evidence:** The UI uses hand-authored markup in
[`web/index.html`](../web/index.html) and feature-oriented Sass files composed
by [`styles/style.scss`](../styles/style.scss). Sass is already split into
shared, app, and many game-specific partials, but the inspected styles show
component rules distributed across those feature files. The browser
application is native JavaScript modules with a Sass build, not a component
framework. A development-only component workbench is now available at
`/components`. It now embeds the production game renderer and prepares real
eraTW demo scenes; standalone button variants call the production
`HOTPATCH_BUTTON` helper. App-chrome tokens in
[`styles/shared/_base.scss`](../styles/shared/_base.scss) are a separate system,
not the source of truth for game controls.

**Why it matters:** A screenshot or mockup is not a source of truth if
production controls use separate markup and CSS. Feature-local styling makes
similar controls drift and makes it hard to tell whether a new UI is reusing
the intended style.

**Recommendation:** Grow the existing small in-repository UI workbench rather
than adopting Storybook for the current stack. It renders actual game components,
with the game's monospace font and display settings. Continue extending it to demonstrate:

- button roles and states: primary/default, secondary, danger, disabled,
  selected, loading, keyboard focus, and compact/controller contexts;
- panels, cards, section headings, forms, toggles, tabs, menus, tooltips, and
  dialogs, including responsive compact layouts;
- empty, loading, success, and error states where those are part of the
  component's behavior.

Back the catalog with shared design tokens (color, spacing, typography,
radius, borders, focus, and elevation) and a small set of reusable component
classes or constructors. Production screens should consume those same tokens
and primitives; the catalog must not become a second copy of the styling.
Keep intentional variants explicit, rather than forcing unrelated game
terminal output and application chrome into one visual style. Add visual
regression snapshots for the catalog once its layout and browser environment
are stable.

Migrate incrementally: the initial tokens, button variants, panel primitives,
development catalog, and common app controls are in place. Replace remaining
high-visibility repeated controls and dialogs, and move feature-specific rules
over as those screens are touched. Avoid a full CSS rewrite before the catalog
can show the desired result.

### 2. Separate server composition from session and resource policy

**Evidence:** [`src/server.ts`](../src/server.ts) is about 950 lines.
`createApp()` starts at line 244 and the same module contains route dispatch,
session state and step validation, runtime creation, replay, game loading,
resource serving, library actions, LLM proxying, and quicksave/continue
coordination.

**Why it matters:** A change to an endpoint can affect session lifetime, save
ordering, or path handling. It is also difficult to test session policy without
constructing the HTTP application.

**Recommendation:** Keep `createApp()` as the composition root, but gradually
extract:

1. A session manager for runtime ownership, expiration, step checks, replay, and
   session cleanup.
2. A game registry/loader for discovery, lazy loading, debug variants, and
   loaded-game caching.
3. A resource resolver for canonical paths, root confinement, MIME types, and
   cache behavior.
4. Route-family handlers that take typed dependencies instead of reaching into
   closure state.

Move one coherent route family at a time and preserve the existing endpoint
behavior. Avoid adding a web framework just to obtain this separation.
`test/server.test.ts` is already a useful behavior harness.

### 3. Decompose `Runtime` behind its existing public facade

**Evidence:** [`src/runtime.ts`](../src/runtime.ts) is about 4,985 lines. The
`Runtime` class begins at line 409; it spans instruction execution and
variables, snapshot/output generation, graphics, save and suspend behavior,
JIT, and character history/tools. The server constructs it directly for game
sessions.

**Why it matters:** Many independent concerns share one mutable object, making
the effects of changes hard to isolate. A wholesale rewrite would be especially
risky because subtle runtime behavior is defined by Emuera compatibility.

**Recommendation:** Retain `Runtime` as the stable facade while extracting
small, low-risk seams first: snapshot assembly, graphics/CBG operations,
persistence/suspend conversion, and the JIT cache. Then isolate execution
services behind narrow interfaces as their dependencies become clear. Prefer
moving behavior with tests unchanged over designing a new engine up front.

Keep the distinction between interpreter state and presentation state visible.
Treat save compatibility as a hard constraint: native `.sav` formats and
variable meanings must not change for browser-only improvements. See the save
compatibility guidance in the [developer guide](./developer-guide.md).

### 4. Make the browser/server run contract explicit

**Evidence:** The browser and server coordinate `session` and `step` values,
input, timeout, resume, replay, and stale-tab rejection. The state is represented
in both [`web/app.js`](../web/app.js) and [`src/server.ts`](../src/server.ts),
with snapshots passed through to rendering.

**Why it matters:** These rules form a protocol even though it is an internal
browser/server interface. Changes can diverge at the boundary, particularly
for replayed output and snapshot metadata.

**Recommendation:** Define and test the request/response shapes for start,
advance, timeout, resume, and snapshot delivery in one place. Centralize
session/step validation in the session layer. Add protocol-level tests that
exercise the JSON boundary without requiring a DOM. Keep the protocol internal:
the repository does not need backward compatibility with old renderer
versions; update both ends and tests together as documented in the
[developer guide](./developer-guide.md).

### 5. Separate compiled program data from execution/JIT caches

**Evidence:** [`src/compiler.ts`](../src/compiler.ts) defines `Instruction`
with expression/assignment caches populated during execution (`parsed`,
`assignment`, `values`, and `cases`), while `Compiled` also carries JIT
counters and compiled state.
The runtime caches compilation on routines.

**Why it matters:** Immutable program representation and mutable execution
caches have different lifetimes. Combining them makes cache invalidation,
debug/game variants, and future reuse harder to reason about.

**Recommendation:** As a focused change, move mutable parse/JIT caches into a
runtime-owned structure keyed by routine or compiled entry. Keep instruction
semantics and cache invalidation unchanged. Validate against both interpreted
and JIT paths using the existing conformance tests.

### 6. Reduce browser orchestration concentration

**Evidence:** [`web/app.js`](../web/app.js) is roughly 3,700 lines and owns the
run lifecycle alongside rendering, inputs, settings, and several integrations.
There are already useful focused modules such as
[`web/auto-advance.js`](../web/auto-advance.js),
[`web/controller-menu.js`](../web/controller-menu.js),
[`web/interaction-history.js`](../web/interaction-history.js), and
[`web/output-tools.js`](../web/output-tools.js).

**Recommendation:** Continue the existing native-ES-module pattern. Extract the
run lifecycle (`start`, `resume`, `submit`, timeout, replay) into a controller
first, then separate snapshot rendering and settings coordination. Pass state
and callbacks explicitly rather than adding new shared globals. Avoid a
bundler or framework migration unless a separate need justifies it.

### 7. Strengthen automated checks before structural changes

**Evidence:** [`package.json`](../package.json) provides `check` and `test`
scripts, and [`tsconfig.json`](../tsconfig.json) applies strict checks to
`src/**/*.ts`. Browser JavaScript is not included in that type-check. The
current [release workflow](../.github/workflows/release.yml) checks packaged
native bindings on each platform and runs `desktop-build.test.ts` on Linux,
but does not run the general type-check and test suite.

**Recommendation:** Add a pull-request CI job that runs `npm ci`,
`npm run check`, and `npm test`; retain the release packaging checks as a
separate job. If the full suite is too slow, measure it and split fast unit
checks from game-dependent/integration checks rather than silently omitting
coverage. Add focused API contract tests as part of recommendation 3.

The test suite is already substantial. Some files are also very large (for
example, `test/html-layout.test.ts` is about 3,000 lines and
`test/interaction-history.test.ts` is about 2,400). Split those by behavior
when editing nearby code, keeping assertions and fixtures intact. Do not make
test-file splitting a prerequisite to functional refactors.

### 8. Make optional and game-specific capabilities explicit

**Evidence:** Runtime and server paths directly coordinate TW-specific midday
saves/history as well as optional character, voice, and LLM features.
[`src/runtime.ts`](../src/runtime.ts) contains the game-specific save gates and
feature integration points.

**Recommendation:** When a feature is next modified, identify whether it is
engine behavior, a game capability, or an application integration. Represent
that distinction with injected capability interfaces at the narrowest useful
boundary. Keep unsupported games explicit; do not broaden midday-save support
until safe continuation points and compatibility are verified for those games.

## Suggested order

1. Build the UI workbench and shared tokens/primitives, then migrate repeated
   high-visibility controls into them.
2. Add pull-request type-check/test automation and keep the existing
   compatibility suite green.
3. Define tests for session and snapshot boundary behavior; extract a
   `SessionManager` without changing the HTTP contract.
4. Extract resource resolution and game loading from server routing.
5. Move runtime snapshot/persistence/graphics seams behind `Runtime` while
   preserving its current API.
6. Separate compiled program data from mutable runtime/JIT state.
7. Extract browser session orchestration and then continue with other UI
   responsibilities as they are touched.

For each step, use the smallest applicable test group first, then run
`npm run check` and `npm test` before merging. Treat native save behavior and
the documented game compatibility limits as invariants throughout.
