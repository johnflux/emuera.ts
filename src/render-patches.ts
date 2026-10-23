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
    url: `/resources/${first.file.split(/[\\/]/).map(encodeURIComponent).join("/")}`,
  };
}

// Patch presentation only: runtime output, LINECOUNT, and ERB control flow stay untouched.
export function patchTitleImage(game: Game, snapshot: Snapshot): Omit<Snapshot, "output"> & { output: BrowserOutput[] } {
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
