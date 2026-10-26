# Sprites and graphics

How images get from the game's `resources/` folder and ERB drawing code to
the browser terminal.

## High level

Emuera has two kinds of image:

1. **Resource sprites**: named rectangles of image files, declared in
   `resources/*.csv`. ERB shows them with `HTML_PRINT "<img src='NAME'>"`.
2. **Runtime graphics**: ERB creates a blank canvas with `GCREATE` and draws
   onto it (`GDRAWSPRITE`, `GDRAWG`, `GCLEAR`, `GFILLRECTANGLE`...).
   `SPRITECREATE` then names a rectangle of that canvas as a new sprite. The
   game builds its highres character portraits this way, by layering a body,
   a face and glasses (`ERB/BODY_INFO/HIGHRES_CHARA.ERB`, via `@画像合成` in
   `ERB/グラフィック表示ライブラリ/グラフィック合成.ERB`).

The interpreter runs in Node and has no pixels. It never decodes or draws
images. Instead:

- **Resource sprites** are metadata: a file plus a crop rectangle. The browser
  loads the file and crops it with CSS.
- **Runtime graphics** are recorded as **display lists**: ordered paint
  operations such as "draw this rectangle of `body.webp` here" or "fill this
  rectangle". When an HTML line shows a runtime-made sprite, the runtime
  attaches that sprite's display list to the output. The browser replays it
  on a `<canvas>`.

```
resources/*.csv ──loader──▶ game.sprites (name → file + rect)
                                  │
ERB: GCREATE/GDRAWSPRITE/... ──▶ runtime.graphics (id → display list)
ERB: SPRITECREATE ─────────────▶ runtime.dynamicSprites (name → G id + rect)
ERB: HTML_PRINT "<img src='X'>" ─▶ Output { type: "html", text, sprites?: { X: definition } }
                                  │
browser renderHtml ── <img src='X'> ──┬─ in output.sprites → paintPicture → <canvas>
                                      └─ otherwise → GET /api/sprite?name=X → <img> cropped by CSS
```

Consequences of this design:

- The server stays cheap: no image libraries and no per-frame pixel work.
- Reads that need pixels can't be answered. `GGETCOLOR` returns 0 and
  `GSAVE`/`GLOAD` are unsupported.
- Each HTML output that shows a runtime sprite carries a full, self-contained
  copy of its picture. Later drawing never changes what was already printed.

## Low level

### 1. Resource sprites (`src/loader.ts`)

At load time every `resources/**/*.csv` row becomes a `Sprite` in
`game.sprites`, keyed by the upper-cased name:

| CSV column | Meaning | `Sprite` field |
|---|---|---|
| 0 | sprite name | map key |
| 1 | image file, relative to the CSV | `file` (relative to `resources/`) |
| 2–5 | crop x, y, width, height (0/omitted = whole image) | `x`, `y`, `width`, `height` |
| 6–7 | optional SPRITEPOS offset | `offsetX`, `offsetY` |
| 8 | animation frame time in ms (default 1000) | frame `delay` |
| 9–10 | optional sprite size, when it differs from the crop | `size` |

Parsing follows Emuera's `AppContents.CreateFromCsv`:

- A group of optional numbers that doesn't parse is ignored, so the default is
  kept. For example, the game's `立ち絵_服_バニー_発情_109,…,540,0,180,180]`
  becomes the whole image, as in Emuera.
- These rows are skipped with a load diagnostic:
  - a file name without an extension;
  - a crop width or height that isn't positive;
  - a frame time that isn't positive.
- A name that is already defined keeps its first definition and adds a
  diagnostic.
- `NAME,ANIME,w,h` declares an animation of size w×h (`animation`). The rows
  right after it with the same name are its frames (`animation.frames`, each a
  crop with an offset and delay). Any other row ends the declaration.

The runtime turns these into frames (see Animations below). `stillFrame()`
gives `/api/sprite` an animation's first frame. The browser normally gets
animations from the html output instead, so this is only a fallback.

### 2. Runtime state (`src/runtime.ts`)

Three maps on `Runtime`, all keyed case-insensitively like Emuera:

- **`spriteSizes`**: a cache of resolved resource sprites as `SpriteInfo`.
  Missing sizes are read from the image header with `imageSize()`, so
  `SPRITEWIDTH` works without decoding. The entry also stores `url`
  (`/resources/...`) and `src`, the crop rectangle.
- **`graphics`**: `GCREATE` id → `Canvas`. A canvas is a `Picture`
  (`width`, `height`, `ops`) plus the current `GSETBRUSH` colour.
- **`dynamicSprites`**: names created by `SPRITECREATE` → `SpriteInfo` with
  `graphics` (the G id) and `rect` (the rectangle on that G). Names created by
  `SPRITEANIMECREATE` → `SpriteInfo` with `frames`.

**Animations.** An animation sprite's `SpriteInfo.frames` is a list of
`AnimationFrame`s `{ url | graphics, src, offset, delay }`:

- CSV `ANIME` frames take their `url` from the resource image.
- `SPRITEANIMEADDFRAME name, G, x, y, w, h, ox, oy, delay` adds a frame that
  keeps a *live* reference to G, like EM's `AnimeFrame.BaseImage`. It returns
  0 when:
  - the sprite isn't an animation, or G doesn't exist;
  - the rectangle isn't positive or doesn't lie inside G;
  - the delay is ≤ 0.
- `animationFrame()` follows EM's `AnimeFrame.Normalize`. Each frame is
  clipped to the sprite's size, keeping the source x/y as EM does. A frame
  entirely outside the sprite draws nothing but still takes up its delay.
- `framePicture()` turns a frame into a sprite-sized `Picture` with one op,
  placed at the frame's offset. A frame whose G was disposed draws nothing.
- Drawing an animation into a G (`GDRAWSPRITE`) uses its first frame, because
  the runtime has no clock.

`sprite(name)` resolves any sprite name. It checks dynamic sprites first, then
resource sprites. Every `SPRITE*` query and drawing call goes through it.

**Live reference versus snapshot.** These follow Emuera's
`SpriteG`/`GraphicsImage`:

- A `SPRITECREATE` sprite keeps a *reference* to its G, not a copy. Drawing
  more onto the G changes the sprite. After `GDISPOSE`, `SPRITECREATED`
  returns 0. If the same id is `GCREATE`d again, the sprite is back.
  `SPRITEDISPOSE` removes the name.
- Drawing a G or a G-backed sprite *into another G* takes a **snapshot**.
  `picture(id)` copies the source's op array, so later changes to the source
  don't affect what was already drawn, just like pixels.

### 3. Display-list format

```ts
type Rect = [x, y, width, height];
interface Picture { width: number; height: number; ops: GraphicOp[] }
type GraphicOp =
  | { op: "image";    url; src: Rect; dest: Rect; matrix? }          // resource file region → dest
  | { op: "graphics"; source: Picture; src: Rect; dest: Rect; matrix? } // nested picture
  | { op: "fill";     color; rect: Rect; replace? }                  // CSS rgba()
  | { op: "mask";     source: Picture; mask: Picture; x; y }         // GDRAWGWITHMASK
```

- Ops are replayed in order on a transparent canvas of `width × height`.
- `src` and `dest` may have negative width or height, which mirrors the image
  as in GDI+.
- `matrix` is a 5×5 GDI+ ColorMatrix: `out[j] = Σ in[i]·m[i][j] + m[4][j]`
  over unpremultiplied RGBA in 0–1.
- Pictures nest: a `graphics` op embeds a whole snapshot.

### 4. Instruction semantics

| Instruction | Effect on the display list |
|---|---|
| `GCREATE id, w, h` | new empty canvas (1–8192 px) |
| `GCREATEFROMFILE id, file` | canvas sized from the file header, with one `image` op |
| `GCLEAR id, argb` | alpha 0: drop all ops (fully transparent). Otherwise: replace all ops with a full-canvas `replace` fill |
| `GCLEAR id, argb, x, y, w, h` | append a `replace` fill (clear the region, then fill it) |
| `GSETCOLOR id, argb, x, y` | append a 1×1 `replace` fill |
| `GSETBRUSH id, argb` | set the canvas brush |
| `GFILLRECTANGLE id, x, y, w, h` | append a fill with the brush, or the default background colour if none was set (Emuera `Config.BackColor`) |
| `GDRAWSPRITE id, name [, x, y [, w, h [, cm]]]` | append the sprite as an `image` op (resource sprite) or a `graphics` op (G-backed). The destination defaults to the sprite's size at (0, 0) |
| `GDRAWG dst, src, dx, dy, dw, dh, sx, sy, sw, sh [, cm]` | append a `graphics` op with a snapshot of `src` |
| `GDRAWGWITHMASK dst, src, mask, x, y` | append a `mask` op. Returns 0 if the sizes differ or the result would go out of bounds |
| `GDISPOSE id` | delete the canvas; sprites referencing it become "not created" |
| `SPRITECREATE name, id [, x, y, w, h]` | register a dynamic sprite. The rectangle may be negative but must overlap the G |

Notes:

- **SPRITEPOS offsets** follow `ASpriteSingle.GraphicsDraw`: when a sprite
  with an offset is drawn into a G, the offset and size are scaled to the
  destination rectangle (`spriteOp`).
- **Colour matrices** (`colorMatrix`) follow Emuera `ReadColormatrix`. The
  argument must be an integer 2D or 3D array variable term. The 5×5 block
  starts at the term's last two indices, and each value is divided by 256.
  Because the expression is needed rather than its value, the 7-argument
  `GDRAWSPRITE` and 11-argument `GDRAWG` forms are handled in the
  raw-arguments hook rather than the ordinary builtin `call`.
- **Colours** (`argbColor`) are `0xAARRGGBB`, validated to 0–0xFFFFFFFF and
  converted to CSS `rgba()`.

### 5. Sending runtime sprites to the browser

Clock sprites inside `.era-clock` use the `era-clock-dial` SVG filter in
[`web/index.html`](../web/index.html): the white dial is 80% opaque, black
hands and numbers stay opaque, and existing transparent pixels stay transparent.
Intermediate shades fade proportionally to their luminance. This affects only
the displayed clock, not its source sprite sheet. The main/shop header's night
clock still uses its separate `era-radium` filter.

`emit()` checks every `html` output. `htmlSprites()` scans the markup for
`src='…'`/`src="…"` attributes. For each one naming a live G-backed sprite,
it adds

```ts
sprites[name] = { width, height, x: 0, y: 0,
  picture: { width, height, ops: [{ op: "graphics", source: <snapshot of G>, src: rect, dest: [0, 0, width, height] }] } }
```

to `Output.sprites`. An animation sprite (CSV or script-made) gets
`frames: [{ picture, delay }]` instead, with one `framePicture()` per frame
and `picture` set to the first frame. The snapshot is taken at print time. A sprite whose G
was disposed isn't attached, and the browser then falls back to
`/api/sprite`, which reports it as unknown. SPRITEPOS offsets are not applied
to `<img>` display.

The payload grows with the number of layers, typically 3–5 image ops for a
portrait. It is repeated for each print, because outputs must render
independently (log replay, reconnects).

### 6. Server (`src/server.ts`)

- `GET /api/sprite?name=X` returns a **resource** sprite's metadata plus its
  `url`, after validating that the file exists inside `resources/`. It has no
  knowledge of runtime sprites.
- `GET /resources/<path>` serves image files, with path traversal rejected.

### 7. Browser rendering (`web/app.js`)

`renderHtml(markup, parent, sprites)` rebuilds allowlisted DOM nodes. Each
`<img>` calls `image(node, token, sprites?.[src])`, which returns a
`span.sprite` holder (`overflow: hidden`) and fills it asynchronously:

- **Resource sprite** (no supplied definition): fetch `/api/sprite` (memoised
  per name in the `sprites` map), load the file into an `<img>`, and offset
  it inside the holder so that only the crop rectangle shows.
- **Runtime sprite** (a definition with `picture`): `paintPicture(picture)`
  produces a canvas. That canvas is cached and shared, so `image()` draws a
  private copy into a new `<canvas>`, which is then cropped and sized exactly
  like an `<img>`.

- **Animation** (a definition with `frames`): every frame is painted as above
  and stacked in the holder, and all but one are `hidden`. `animate()`
  registers the holder with one shared `requestAnimationFrame` loop.
  - Like EM's `SpriteAnime`, each sprite *name* has one clock
    (`animationClocks`), started the first time it is shown. Every copy on
    screen shows the same frame.
  - `animationFrameIndex()` copies EM's `GetCurrentFrame`: it takes the
    elapsed time modulo the total of the delays and returns the first frame
    whose cumulative delay reaches it.
  - The loop only toggles `hidden` when the frame changes. Holders are
    dropped once they leave the DOM or the screen generation changes, and the
    loop stops when none are left.

Sizing is the same for all of these: the `height` attribute is a percentage of the
font size (or `Npx`) and defaults to one line. `width` defaults to keeping
the aspect ratio.

`paintPicture` / `paintOps`:

1. **Cache:** `paintedPictures` is keyed by `JSON.stringify(picture)` and
   bounded to 200 entries. Identical portraits printed repeatedly are painted
   once. Source files are cached as decoded `Image`s in `sourceImages`.
2. **Load in parallel:** all images and nested pictures (recursively through
   `paintPicture`, so nested results are cached too) load first. Then the ops
   are applied in order.
3. **Apply each op:**
   - `drawRect` normalises negative rectangles into flips.
   - Without a matrix it calls `drawImage` directly.
   - With a matrix it draws to a temporary layer of the destination size,
     transforms the pixels with `applyColorMatrix` (`getImageData`, clamp to
     0–255), and composites the layer.
   - `fill` with `replace` calls `clearRect` and then `fillRect`. Plain fills
     blend normally.
   - `mask` blends source over destination pixel by pixel, weighted by the
     mask's blue channel, using Emuera's `(w+1)/256` formula.

Every image task is pushed onto `pendingImages`. A screen update is built
off-screen and committed only after all of them settle, so portraits don't
pop in after the text. A stale `generation` token (the screen was cleared)
abandons the work. Failures replace the holder with
`[Image NAME: reason]`.

### 8. The title image patch

The title screen prints 35 strip sprites, `TW_title000`–`034`.
`src/render-patches.ts` detects that exact sequence in the browser snapshot
and replaces it with a single `title-image` output whose `sprite` is the
combined rectangle. The browser renders it through the same `image()`
function. This is a presentation-only optimisation for this game.

### 9. Other places that use sprite sizes

`HTML_STRINGLEN` (`htmlWidth` in `src/html.ts`) measures `<img>` widths from
`sprite(name)` sizes. Layout calculations therefore see runtime sprites as
well.

## Limits

- No pixel read-back: `GGETCOLOR` returns 0, `GSAVE`/`GLOAD` return 0, and
  `SPRITEGETCOLOR` isn't implemented.
- Animations only animate in the browser. Inside a G (`GDRAWSPRITE`) an
  animation is its first frame. Script frames show their G as it was when the
  html was printed.
  Animated sprites draw nothing.
- `GSETPEN`/`GSETFONT` are accepted but have no drawing effect. Text and line
  drawing into Gs isn't implemented.
- Fills use straightforward canvas blending. GDI+'s source-copy fine points
  aren't reproduced beyond `GCLEAR`'s replace.

## Debugging

To inspect what the runtime sends, run a scratch routine through
`new Runtime(game).start("ENTRY")`. For example, call
`HIGHRES_GET_BASE_RESOURCE(1, "顔絵", "", "通常", "", "")` after
`ADDCHARA`/`FLAG:画像表示 = 1`, then `PRINT_IMAGE(RESULTS:0)`, and print
`output.sprites` from the snapshot. The unit test
`graphics compose sprites into display lists sent with html that shows them`
in `test/builtins.test.ts` covers the op structure.

The Emuera EM sources this mirrors are `Emuera/UI/Game/Image/GraphicsImage.cs`,
`CroppedImage.cs` and `AppContents.cs`, and the `G*`/`SPRITE*` methods in
`FunctionMethodCreator` (ReadColor, ReadColormatrix, SpriteCreateMethod).
