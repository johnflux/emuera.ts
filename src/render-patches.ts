import type { Game, Sprite } from "./loader.js";
import type { Output, Snapshot, Style } from "./runtime.js";

export interface TitleImageOutput {
  type: "title-image";
  sprite: Sprite & { url: string };
  lines: number;
  style: Style;
}
export type BrowserOutput = Output | TitleImageOutput;

const TITLE_STRIPS = 35;
const stripName = (index: number): string => `TW_TITLE${String(index).padStart(3, "0")}`;

function titleRectangle(game: Game): (Sprite & { url: string }) | null {
  const first = game.sprites.get(stripName(0));
  if (!first || first.width <= 0 || first.height <= 0) return null;
  for (let i = 1; i < TITLE_STRIPS; i++) {
    const strip = game.sprites.get(stripName(i));
    if (!strip || strip.file !== first.file || strip.x !== first.x ||
      strip.y !== first.y + i * first.height || strip.width !== first.width || strip.height !== first.height)
      return null;
  }
  return {
    ...first, height: first.height * TITLE_STRIPS,
    url: `${game.resourceBase}${first.file.split(/[\\/]/).map(encodeURIComponent).join("/")}`,
  };
}

/**
 * Browser-only optimization for the bundled game's title artwork, not an Emuera
 * language feature. Its ERB prints TW_title000 through TW_title034 as 35 centered
 * HTML lines. Those sprites are adjacent horizontal slices of the same image;
 * rendering each separately would create 35 cropped images and metadata lookups
 * for artwork that the browser can display with a single crop.
 *
 * Called when serializing a runtime snapshot for the browser, after the original
 * ERB has executed. titleRectangle first verifies that all 35 sprites share a
 * file, x coordinate, width and height, with exactly contiguous y coordinates.
 * We then match the complete, ordered sequence of exact HTML events, requiring
 * newlines, identical styles and a line boundary before the sequence. Anything
 * incomplete or changed falls back to ordinary output; unrelated side-by-side
 * images and images mixed with text are deliberately not combined.
 *
 * A match becomes one presentation-only title-image event containing the combined
 * source rectangle and resource URL. The browser scales it to 35 text-line heights
 * and retains that logical line count, clipping the bottom when CLEARLINE removes
 * only part of it. The crop uses the validated strip bounds, not the whole source
 * file, which may contain additional pixels outside the title.
 *
 * Neither the snapshot nor sprite metadata is mutated. The interpreter still
 * executes all original prints, so LINECOUNT, print-buffer operations and ERB
 * control flow see the unmodified behavior, with no edits to the game's files.
 */
export function patchTitleImage(game: Game, snapshot: Snapshot): Omit<Snapshot, "output"> & { output: BrowserOutput[] } {
  const discordCall = 'CALLSHARP LAUNCH_BROWSER("https://discord.gg/zCWzA8kbgp")';
  if (game.routines.get("SYSTEM_TITLE")?.some((routine) => routine.lines.some((line) => line.text === discordCall))) {
    snapshot = {
      ...snapshot,
      output: snapshot.output.map((item) => item.type === "button" && item.value === "100"
        && item.text === "[100] Discord Server (Opens browser)"
        ? { type: "html", text: '<a href="https://discord.gg/zCWzA8kbgp" target="_blank" rel="noopener noreferrer">[100] Discord Server</a>', newline: false, style: item.style }
        : item),
    };
  }
  const sprite = titleRectangle(game);
  if (!sprite) return snapshot;
  const output: BrowserOutput[] = [];
  for (let i = 0; i < snapshot.output.length; i++) {
    const first = snapshot.output[i]!;
    const matches = first.type === "html" && Array.from({ length: TITLE_STRIPS }, (_, offset) => {
      const item = snapshot.output[i + offset];
      return item?.type === "html" && item.newline &&
        item.text === `<p align='center'><img src='TW_title${String(offset).padStart(3, "0")}'></p>` &&
        item.style.color === first.style.color && item.style.background === first.style.background &&
        item.style.alignment === first.style.alignment && item.style.fontStyle === first.style.fontStyle;
    }).every(Boolean);
    // Never merge into an unfinished preceding line.
    const previous = snapshot.output[i - 1];
    const atLineStart = i === 0 || previous?.type === "clear" ||
      (previous !== undefined && "newline" in previous && previous.newline);
    if (matches && atLineStart) {
      output.push({ type: "title-image", sprite, lines: TITLE_STRIPS, style: { ...first.style } });
      i += TITLE_STRIPS - 1;
    } else output.push(first);
  }
  return { ...snapshot, output };
}
