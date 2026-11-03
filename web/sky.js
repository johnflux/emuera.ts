/** Approximate solar time at 36 N; each 31-day game season spans a quarter of the solar year. */
export function sky(node, element) {
  const value = node.getAttribute("data-minutes");
  if (!/^-?\d+$/.test(value ?? "") || !Number.isSafeInteger(Number(value)))
    throw new Error(`Unsupported sky minutes: ${value}`);
  const minutes = ((Number(value) % 1440) + 1440) % 1440;
  const season = Number(node.getAttribute("data-season")), day = Number(node.getAttribute("data-day"));
  if (!Number.isInteger(season) || season < 1 || season > 4 || !Number.isInteger(day) || day < 1 || day > 31)
    throw new Error(`Unsupported sky date: ${season}/${day}`);
  const radians = Math.PI / 180;
  const yearDay = 59 + ((season - 1) + (day - 1) / 31) * 365 / 4;
  const declination = 23.44 * radians * Math.sin(2 * Math.PI * (yearDay - 80) / 365);
  const hourAngle = Math.acos((Math.sin(-.833 * radians) - Math.sin(36 * radians) * Math.sin(declination))
    / (Math.cos(36 * radians) * Math.cos(declination)));
  const halfDay = hourAngle * 720 / Math.PI;
  const sunrise = 720 - halfDay, sunset = 720 + halfDay;
  const night = minutes < sunrise || minutes >= sunset;
  const twilight = 30;
  const daylight = Math.max(0, Math.min(1, (minutes - sunrise) / (sunset - sunrise)));
  const progress = night ? ((minutes - sunset + 1440) % 1440) / (1440 - 2 * halfDay) : daylight;
  const elevation = Math.sin(progress * Math.PI);
  const warmth = night ? 0 : Math.max(0, 1 - elevation * 1.6);
  const phase = minutes < sunrise - twilight || minutes >= sunset + twilight ? "night"
    : minutes < sunrise + twilight ? "dawn" : minutes >= sunset - twilight ? "evening"
    : minutes < 600 ? "morning" : "day";
  element.classList.remove("era-sky-dawn", "era-sky-morning", "era-sky-day", "era-sky-evening", "era-sky-night");
  element.classList.add(`era-sky-${phase}`);
  element.classList.toggle("era-sky-moon", night);
  element.style.setProperty("--sky-orbit", String(progress));
  element.style.setProperty("--sky-orb-top", `${93 - 83 * elevation}px`);
  element.style.setProperty("--sky-warmth", `${night && phase !== "night" ? 100 : warmth * 100}%`);
  element.style.setProperty("--sky-darkness", String(night ? Math.min(1, Math.min(Math.abs(minutes - sunrise), Math.abs(minutes - sunset)) / twilight) : 0));
  const caveDaylight = night ? 0 : Math.sin(daylight * Math.PI) ** 2;
  element.style.setProperty("--cave-daylight", `${caveDaylight * 100}%`);
  return element;
}

/** A long stepped sequence keeps flame bursts irregular without timers tied to removed headers. */
export function lanternFlicker(random = Math.random) {
  const stops = ["0 0%"];
  let elapsed = 0, opacity = 0;
  const changes = [];
  const change = (next, seconds) => {
    elapsed += seconds;
    changes.push([elapsed, opacity, next]);
    opacity = next;
  };
  for (let burst = 0; burst < 16; burst++) {
    const flashes = 1 + Math.floor(random() * 3);
    change(.4 + random() * .2, 10 + random() * 20);
    for (let flash = 1; flash < flashes; flash++) {
      change(0, .08 + random() * .1);
      change(.4 + random() * .2, .08 + random() * .12);
    }
    change(.25 + random() * .1, .08 + random() * .1);
    change(.15 + random() * .1, .08 + random() * .1);
    change(.05 + random() * .05, .08 + random() * .1);
    change(0, .08 + random() * .1);
  }
  elapsed += 10;
  for (const [time, before, after] of changes) {
    const percent = time / elapsed * 100;
    stops.push(`${before} ${percent}%`, `${after} ${percent}%`);
  }
  stops.push("0 100%");
  return { duration: elapsed, easing: `linear(${stops.join(", ")})` };
}

/** Apply panorama images while leaving weather, sky and SVG fallbacks to the shared stylesheet. */
export function prepareSkyArt(outputRoot, manifest, sourceImage, pendingImages, artwork = "auto") {
  const skies = [...outputRoot.querySelectorAll(".era-sky[class*='era-area-']:not([data-area-art])")];
  for (const sky of skies) {
    sky.dataset.areaArt = "";
    const area = [...sky.classList].find((name) => /^era-area-\d+$/.test(name))?.slice("era-area-".length);
    const season = [...sky.classList].find((name) => name.startsWith("era-season-"))?.slice("era-season-".length);
    const night = artwork === "auto" ? sky.matches(".era-sky-night, .era-sky-dawn") : artwork === "night";
    const sets = manifest[area] ?? {};
    const artSeason = sets[`${season}-day`]?.middle || sets[`${season}-night`]?.middle ? season : "neutral";
    const lit = night && sets[`${artSeason}-night`]?.middle;
    const set = lit ? sets[`${artSeason}-night`] : sets[`${artSeason}-day`];
    if (!set?.middle) continue;
    const weatherSet = !night && sky.matches(".era-weather-cloudy, .era-weather-rain, .era-weather-storm, .era-weather-fog, .era-weather-snow, .era-weather-blizzard")
      ? sets[`${artSeason}-night`] : undefined;
    const blend = weatherSet && ["left", "middle", "right"].every((part) => set[part] && weatherSet[part]);
    sky.dataset.areaArt = `${artSeason}-${lit ? "night" : "day"}`;
    sky.classList.add("era-area-art");
    sky.classList.toggle("era-area-art-night", Boolean(lit));
    sky.classList.toggle("era-area-art-weather", Boolean(blend));
    if (area === "9") {
      const bats = document.createElement("span");
      bats.className = "era-cave-bats";
      bats.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 4; i++) bats.append(document.createElement("span"));
      sky.querySelector(".era-sky-landmark")?.append(bats);
      const lantern = document.createElement("span");
      lantern.className = "era-cave-lantern";
      lantern.setAttribute("aria-hidden", "true");
      const flicker = lanternFlicker();
      lantern.style.setProperty("--lantern-flicker-duration", `${flicker.duration}s`);
      lantern.style.setProperty("--lantern-flicker-pattern", flicker.easing);
      lantern.style.setProperty("--lantern-flicker-delay", `${-Math.random() * flicker.duration}s`);
      sky.querySelector(".era-sky-landmark")?.append(lantern);
    }
    const header = sky.closest(".era-main-header") ?? sky;
    for (const part of ["left", "middle", "right"]) {
      if (!set[part]) continue;
      // Seasonal palettes leave water unchanged; spring isolates it without shimmering winter's pale foliage.
      if (area === "7" && sets["spring-day"]?.[part])
        sky.style.setProperty(`--area-water-${part}`, `url("${sets["spring-day"][part]}")`);
      sky.style.setProperty(`--area-${part}`, `url("${set[part]}")`);
      pendingImages.push(sourceImage(set[part]).then((img) => {
        if (part === "middle") header.style.setProperty("--area-art-height", `${img.naturalHeight}px`);
        else sky.style.setProperty(`--area-${part}-width`, `${img.naturalWidth}px`);
      }, (error) => console.warn(`Area picture ${set[part]}:`, error)));
      if (blend) {
        sky.style.setProperty(`--area-weather-${part}`, `url("${weatherSet[part]}")`);
        pendingImages.push(sourceImage(weatherSet[part])
          .catch((error) => console.warn(`Area picture ${weatherSet[part]}:`, error)));
      }
    }
  }
}
