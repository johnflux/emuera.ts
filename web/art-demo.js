import { sky, prepareSkyArt } from "./sky.js";

const controls = document.querySelector("#art-controls");
const preview = document.querySelector("#art-preview");
const status = document.querySelector("#art-status");
const retry = document.querySelector("#retry");
const time = document.querySelector("#time");
const minutes = document.querySelector("#minutes");
const overlap = document.querySelector("#overlap");
const overlapValue = document.querySelector("#overlap-value");
const overlaps = new Map();
const overlapKey = () => `${controls.elements.location.value}-${controls.elements.season.value}`;
const seasons = ["spring", "summer", "autumn", "winter"];
let manifest;
let generation = 0;

async function render() {
  const token = ++generation;
  if (!controls.reportValidity() || !manifest) return;
  status.removeAttribute("data-error");
  status.textContent = "Loading preview...";
  const values = new FormData(controls);
  const season = seasons[Number(values.get("season")) - 1];
  const header = document.createElement("div");
  header.className = "era-main-header";
  const scene = document.createElement("div");
  scene.className = `era-sky era-area-${values.get("location")} era-season-${season} era-weather-${String(values.get("weather")).toLowerCase()}`;
  scene.dataset.minutes = String(Number(time.value.slice(0, 2)) * 60 + Number(time.value.slice(3)));
  scene.dataset.season = values.get("season");
  scene.dataset.day = values.get("day");
  sky(scene, scene);
  if (values.get("artwork") === "day") scene.classList.add("era-area-art-day");
  const view = document.createElement("span");
  view.className = "era-sky-view";
  for (const part of ["orb", "clouds", "landmark", "fall", "land"]) {
    const layer = document.createElement("span");
    layer.className = `era-sky-${part}`;
    view.append(layer);
  }
  scene.append(view);
  header.append(scene);
  const stage = document.createElement("div");
  stage.append(header);
  const pending = [], errors = [];
  const loadImage = (image, url) => new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => {
      errors.push(`Could not load ${url}`);
      reject(new Error(`Could not load ${url}`));
    };
    image.src = url;
  });
  prepareSkyArt(stage, manifest, async (url) => {
    const image = new Image();
    await loadImage(image, url);
    return image;
  }, pending, values.get("artwork"));
  await Promise.all(pending);
  if (token !== generation) return;
  if (!scene.classList.contains("era-area-art")) {
    const image = new Image();
    try { await loadImage(image, `/areas/${values.get("location")}-${["shrine", "temple", "village", "mansion", "bamboo", "forest", "netherworld", "foothills", "summit", "underworld", "moon"][Number(values.get("location"))]}.svg`); }
    catch (error) { console.warn("Landmark preview unavailable:", error); }
    if (token !== generation) return;
  }
  const savedOverlap = overlaps.get(overlapKey());
  if (savedOverlap !== undefined) scene.style.setProperty("--area-art-overlap", `${savedOverlap}px`);
  preview.replaceChildren(header);
  overlap.value = String(Number.parseFloat(getComputedStyle(scene).getPropertyValue("--area-art-overlap")));
  overlapValue.value = `${overlap.value}px`;
  const phase = [...scene.classList].find(name => /^era-sky-(dawn|morning|day|evening|night)$/.test(name)).slice(8);
  status.textContent = errors.length ? errors.join("; ")
    : `${time.value} / ${phase} sky / ${scene.dataset.areaArt || "SVG landmark (no panorama for this season)"}${scene.classList.contains("era-area-art-weather") ? " / bad-weather blend" : ""}`;
  status.toggleAttribute("data-error", errors.length > 0);
}

async function load() {
  retry.hidden = true;
  try {
    const response = await fetch("/api/areas");
    if (!response.ok) throw new Error(`Artwork list returned HTTP ${response.status}`);
    manifest = await response.json();
    await render();
  } catch (error) {
    console.error("Artwork demo failed:", error);
    status.textContent = `Could not load artwork: ${error.message}`;
    status.setAttribute("data-error", "");
    retry.hidden = false;
  }
}

controls.addEventListener("submit", event => event.preventDefault());
controls.addEventListener("input", event => {
  if (event.target === overlap) {
    overlaps.set(overlapKey(), Number(overlap.value));
    overlapValue.value = `${overlap.value}px`;
    preview.querySelector(".era-sky")?.style.setProperty("--area-art-overlap", `${overlap.value}px`);
    return;
  }
  if (event.target === minutes) {
    const value = Number(minutes.value);
    time.value = `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  } else if (event.target === time && time.value) {
    minutes.value = String(Number(time.value.slice(0, 2)) * 60 + Number(time.value.slice(3)));
  }
  render().catch(error => {
    console.error("Artwork preview failed:", error);
    status.textContent = `Could not render preview: ${error.message}`;
    status.setAttribute("data-error", "");
  });
});
retry.addEventListener("click", load);
load();
