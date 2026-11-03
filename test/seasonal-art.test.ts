import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { decodePng, type Picture } from "../src/area-art.js";
import { DERIVED_SEASONS, SEASONAL_AREAS, seasonalPalette } from "../src/seasonal-art.js";

test("seasonal palette changes plants while retaining architecture, water, lights and alpha", () => {
  const day: Picture = { width: 6, height: 144, data: new Uint8Array(6 * 144 * 4) };
  const colours = [[60, 145, 40, 128], [220, 110, 170, 255], [80, 140, 195, 255],
    [150, 90, 65, 255], [230, 180, 90, 255], [0, 0, 0, 0]];
  colours.forEach((colour, x) => day.data.set(colour, (80 * 6 + x) * 4));
  const night: Picture = { ...day, data: day.data.slice() };
  for (let i = 0; i < night.data.length; i += 4) for (let c = 0; c < 3; c++)
    night.data[i + c] = Math.round(night.data[i + c]! * .4);
  night.data.set([225, 148, 54, 255], (80 * 6 + 4) * 4);
  for (const season of DERIVED_SEASONS) {
    const output = seasonalPalette(day, night, season);
    for (const x of [0, 1]) {
      const i = (80 * 6 + x) * 4;
      assert.notDeepEqual(output.day.data.slice(i, i + 4), day.data.slice(i, i + 4));
    }
    for (const x of [2, 3, 4, 5]) {
      const i = (80 * 6 + x) * 4;
      assert.deepEqual(output.day.data.slice(i, i + 4), day.data.slice(i, i + 4));
      assert.deepEqual(output.night.data.slice(i, i + 4), night.data.slice(i, i + 4));
    }
    assert.equal(output.day.data[(80 * 6) * 4 + 3], 128, "feathering is unchanged");
  }
  assert.deepEqual([...day.data.slice(80 * 6 * 4, 80 * 6 * 4 + 4)], colours[0], "source is not mutated");
  const autumn = seasonalPalette(day, night, "autumn").day.data;
  const bamboo = seasonalPalette(day, night, "autumn", true).day.data;
  const winter = seasonalPalette(day, night, "winter").day.data;
  const i = 80 * 6 * 4;
  assert.ok(autumn[i]! > autumn[i + 1]!, "deciduous leaves become warm gold");
  assert.ok(bamboo[i + 1]! > bamboo[i]!, "bamboo stays olive rather than orange");
  assert.ok(winter[i + 2]! > winter[i + 1]! && winter[i + 1]! > winter[i]!, "frost uses a cool palette");
  assert.throws(() => seasonalPalette(day, { ...night, width: 7 }, "summer"), /dimensions must match/);
  const misaligned = { ...night, data: night.data.slice() };
  misaligned.data[i + 3] = 0;
  assert.throws(() => seasonalPalette(day, misaligned, "summer"), /alpha must match/);
});

for (const area of SEASONAL_AREAS)
test(`${area} has complete aligned seasonal palettes with preserved non-plant detail`, async () => {
  for (const part of ["left", "middle", "right"]) {
    const root = new URL(`../web/areas/${area}/`, import.meta.url);
    const springDay = decodePng(await readFile(new URL(`spring-day-${part}.png`, root)));
    const springNight = decodePng(await readFile(new URL(`spring-night-${part}.png`, root)));
    for (const season of DERIVED_SEASONS) {
      const expected = seasonalPalette(springDay, springNight, season, area === "4-bamboo");
      for (const phase of ["day", "night"] as const) {
        const art = decodePng(await readFile(new URL(`${season}-${phase}-${part}.png`, root)));
        assert.equal(art.width, springDay.width);
        assert.equal(art.height, 144);
        assert.deepEqual(art.data, expected[phase].data, "stored artwork matches the selective palette");
        let changed = 0, light = 0, sourceLight = 0;
        const source = phase === "day" ? springDay : springNight;
        for (let i = 0; i < art.data.length; i += 4) {
          assert.equal(art.data[i + 3], source.data[i + 3], "silhouettes, seams and overlays retain exact alpha");
          if (!art.data[i + 3]) continue;
          if (art.data[i] !== source.data[i] || art.data[i + 1] !== source.data[i + 1] || art.data[i + 2] !== source.data[i + 2]) changed++;
          light += art.data[i]! + art.data[i + 1]! + art.data[i + 2]!;
          sourceLight += source.data[i]! + source.data[i + 1]! + source.data[i + 2]!;
        }
        assert.ok(changed > 100, `${season}/${phase}/${part} visibly changes vegetation`);
        assert.ok(light / sourceLight > .65 && light / sourceLight < 2.5, "palette stays legible");
      }
    }
  }
});
