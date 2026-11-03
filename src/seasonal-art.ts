import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, type Picture } from "./area-art.js";

export const SEASONAL_AREAS = ["1-temple", "2-village", "3-mansion", "4-bamboo", "5-forest", "7-foothills", "8-summit"] as const;
export const DERIVED_SEASONS = ["summer", "autumn", "winter"] as const;
type Season = typeof DERIVED_SEASONS[number];

export function seasonalPalette(day: Picture, night: Picture, season: Season, evergreen = false) {
  if (day.width !== night.width || day.height !== night.height || day.data.length !== night.data.length)
    throw new Error("Seasonal source day/night dimensions must match");
  const result = { day: { ...day, data: day.data.slice() }, night: { ...night, data: night.data.slice() } };
  for (let i = 0; i < day.data.length; i += 4) {
    if (day.data[i + 3] !== night.data[i + 3]) throw new Error("Seasonal source day/night alpha must match");
    if (!day.data[i + 3]) continue;
    const r = day.data[i]!, g = day.data[i + 1]!, b = day.data[i + 2]!;
    // Bright retained night pixels are lamps/windows, not foliage.
    if (r > 100 && night.data[i]! > r * .75) continue;
    const green = g > r * 1.08 && g > b * 1.12;
    const blossom = r > 100 && b > 75 && r > g * 1.2 && b > g * 1.08;
    const y = Math.floor(i / 4 / day.width);
    const soil = y >= day.height - 16 && r > b * 1.2 && g > b * 1.08 && g > r * .65;
    if (!green && !blossom && !(season === "winter" && soil)) continue;
    const light = (r * .2126 + g * .7152 + b * .0722) / 255;
    let colour: number[];
    if (season === "summer") {
      colour = blossom ? [32 + light * 65, 55 + light * 130, 24 + light * 55]
        : [r * .85, Math.min(255, g * 1.08), b * .9];
    } else if (season === "autumn") {
      colour = evergreen && green ? [g * .83, g * .91, b * .85]
        : [45 + light * 205, 22 + light * 145, 16 + light * 48];
    } else {
      const frost = Math.max(0, Math.min(1, (light - .08) / .7));
      colour = [35 + frost * 190, 48 + frost * 183, 65 + frost * 180];
    }
    for (let c = 0; c < 3; c++) {
      const value = Math.round(Math.max(0, Math.min(255, colour[c]!)));
      result.day.data[i + c] = value;
      // Keep the original moonlit grading and warm-light selections exactly aligned.
      result.night.data[i + c] = Math.min(255, Math.round(value * night.data[i + c]! / Math.max(1, day.data[i + c]!)));
    }
  }
  return result;
}

async function exists(url: URL) {
  try { await access(url); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function main() {
  for (const area of SEASONAL_AREAS) {
    const root = new URL(`../web/areas/${area}/`, import.meta.url);
    for (const season of DERIVED_SEASONS) {
      const files = ["left", "middle", "right"].flatMap(part => ["day", "night"].map(phase => new URL(`${season}-${phase}-${part}.png`, root)));
      const present = await Promise.all(files.map(exists));
      if (present.every(Boolean)) { console.log(`${area}/${season}: already complete`); continue; }
      if (present.some(Boolean)) throw new Error(`Refusing to replace partially existing artwork: ${area}/${season}`);
      const outputs = [];
      for (const part of ["left", "middle", "right"]) {
        const day = decodePng(await readFile(new URL(`spring-day-${part}.png`, root)));
        const night = decodePng(await readFile(new URL(`spring-night-${part}.png`, root)));
        const images = seasonalPalette(day, night, season, area === "4-bamboo");
        for (const phase of ["day", "night"] as const)
          outputs.push({ url: new URL(`${season}-${phase}-${part}.png`, root), bytes: encodePng(images[phase]) });
      }
      for (const output of outputs) await writeFile(output.url, output.bytes, { flag: "wx" });
      console.log(`${area}/${season}: generated six panels`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
