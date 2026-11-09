const frame = document.querySelector("#game-preview");
const viewport = document.querySelector(".ui-workbench-viewport");
const status = document.querySelector("#preview-status");
const links = [...document.querySelectorAll("[data-sample]")];
const disabledToggle = document.querySelector("#preview-disabled");
const hintsToggle = document.querySelector("#preview-controller-hints");
const chromeStates = new Map();

function applyPreviewState() {
  const disabled = disabledToggle.checked;
  const controllerHints = hintsToggle.checked;
  for (const [control, original] of chromeStates) {
    const unavailable = disabled || original.disabled;
    if (control instanceof HTMLButtonElement) control.disabled = unavailable;
    control.setAttribute("aria-disabled", String(unavailable));
    if (control instanceof HTMLAnchorElement) {
      if (unavailable) control.removeAttribute("href");
      else if (original.href !== null) control.setAttribute("href", original.href);
    }
    control.classList.toggle("has-controller", controllerHints);
  }
  const doc = frame.contentDocument;
  if (doc?.body?.classList.contains("is-component-preview"))
    doc.dispatchEvent(new frame.contentWindow.CustomEvent("era-preview-state", { detail: { disabled, controllerHints } }));
}
disabledToggle.addEventListener("change", applyPreviewState);
hintsToggle.addEventListener("change", applyPreviewState);
const descriptions = {
  chrome: "App and library button variants. Use the control bar to inspect disabled and controller-hint states.",
  buttons: "Every explicit game button variant and state, including production HOTPATCH_BUTTON actions, map controls, tabs, icons, setup, calendar, and relationship buttons.",
  main: "The real main screen: character cards, meters, action groups, chips, favourites, toggles, filters, player panel, and sidebar, with two people present.",
  alone: "The real main screen with an empty room.",
  "time-stopped": "The real main screen with time stopped and two people present.",
  sleep: "The game's actual sleep menu, before waking.",
  inventory: "The game's actual inventory dialog, with category tabs, item rows, quantities, and filtering.",
  sheet: "The game's actual character sheet, with character tabs, page tabs, meters, and close control.",
  calendar: "The game's actual calendar dialog.",
  map: "The real movement screen: map tabs, room markers, Places sidebar, current location, return and exit buttons, Nearby and More on this map lists.",
  relationships: "The real relationship dialog. Its existing demo controls switch between friendship and relationship states.",
};
function sample() {
  const name = location.hash.slice(1);
  return Object.hasOwn(descriptions, name) ? name : "main";
}
function showSample() {
  const name = sample();
  for (const link of links) {
    if (link.dataset.sample === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.querySelector("#preview-description").textContent = descriptions[name];
  const chrome = name === "chrome";
  document.querySelector("#chrome-buttons").hidden = !chrome;
  viewport.hidden = chrome;
  if (chrome) {
    frame.removeAttribute("src");
    status.textContent = "";
    return;
  }
  frame.title = `In-game preview: ${links.find((link) => link.dataset.sample === name).textContent}`;
  status.textContent = "Loading game preview...";
  frame.src = `/?component=${name}`;
}
frame.addEventListener("load", () => {
  status.textContent = "";
  applyPreviewState();
});
document.querySelector("#preview-size").addEventListener("change", (event) => {
  viewport.dataset.size = event.target.value;
});
document.querySelector("#reload-preview").addEventListener("click", showSample);
window.addEventListener("hashchange", showSample);
for (const { name, html } of CHROME_BUTTON_SAMPLES) {
  if (/\s(?:disabled(?:\s|>)|aria-disabled="true")/.test(html)) continue;
  const sample = document.createElement("article");
  sample.className = "ui-button-sample";
  const heading = document.createElement("h2");
  heading.textContent = name;
  const path = document.createElement("div");
  path.className = "era-component-path";
  const controls = document.createElement("div");
  controls.className = "ui-button-sample-controls";
  controls.innerHTML = html;
  const enabled = controls.firstElementChild;
  if (enabled instanceof HTMLButtonElement && enabled.getAttribute("aria-disabled") === "true")
    enabled.disabled = true;
  for (const name of enabled.classList) {
    const code = document.createElement("code");
    code.textContent = `.${name}`;
    path.append(code);
  }
  chromeStates.set(enabled, { disabled: enabled.matches(":disabled, [aria-disabled='true']"), href: enabled.getAttribute("href") });
  sample.append(heading, path, controls);
  document.querySelector("#chrome-buttons").append(sample);
}
applyPreviewState();
showSample();
import { CHROME_BUTTON_SAMPLES } from "./chrome-button-samples.js";
