export function activateControllerAction(selector = ".era-timestop-button") {
  if (document.body.classList.contains("is-home")
    || document.querySelector("dialog[open], .era-dialog:popover-open, #menu-panel:not([hidden])")) return;
  const action = document.querySelector(`.screen.is-active button${selector}:enabled:not(.is-stale)`);
  if (!action || action.closest("[hidden], [inert]") || !action.getClientRects().length) return;
  const style = getComputedStyle(action);
  if (style.visibility === "hidden" || style.display === "none") return;
  action.click();
}

export function activateMapTab(direction) {
  if (document.querySelector("dialog[open], .era-dialog:popover-open, #menu-panel:not([hidden])")) return;
  const group = document.querySelector(".screen.is-active .era-move-tabs");
  if (!group || group.closest("[hidden], [inert]") || !group.getClientRects().length) return;
  const tabs = [...group.querySelectorAll("button.choice:not(.is-stale)")];
  const current = tabs.findIndex((tab) => tab.classList.contains("era-move-current"));
  if (current < 0) return;
  const next = tabs[current + direction];
  if (!next || next.disabled || next.closest("[hidden], [inert]") || !next.getClientRects().length) return;
  next.focus({ preventScroll: true });
  next.click();
}

export function activateMapBack() {
  if (document.querySelector("dialog[open], .era-dialog:popover-open, #menu-panel:not([hidden])")) return;
  const back = document.querySelector(".screen.is-active button.era-move-back:enabled:not(.is-stale)");
  if (!back || back.closest("[hidden], [inert]") || !back.getClientRects().length) return;
  const style = getComputedStyle(back);
  if (style.visibility === "hidden" || style.display === "none") return;
  back.click();
}

export function setupControllerMenu({ restart, library, settings, exit, canRestart, canExit, onError, onY = activateControllerAction, onX = () => activateControllerAction(".era-repeat") }) {
  const hintsKey = "era-typescript.controller-hints";
  const hintsToggle = document.querySelector("#controller-hints-toggle");
  const saved = localStorage.getItem(hintsKey)
    ?? (localStorage.getItem("era-typescript.force-controller") === "1" ? "on" : "auto");
  const modes = ["auto", "on", "off"];
  let mode = modes.includes(saved) ? saved : "auto";
  let detected = false;
  function applyControllerMode() {
    const enabled = mode === "on" || (mode === "auto" && (detected || globalThis.eraDesktop?.handheld === true));
    document.body.classList.toggle("has-controller", enabled);
    setCheckboxState(hintsToggle, mode === "auto" ? "mixed" : mode === "on", enabled);
    document.querySelector("#controller-hints-label").textContent = `Controller hints: ${mode === "auto" ? `Auto (${enabled ? "On" : "Off"})` : mode === "on" ? "On" : "Off"}`;
  }
  applyControllerMode();
  hintsToggle.addEventListener("click", (event) => {
    event.preventDefault();
    mode = modes[(modes.indexOf(mode) + 1) % modes.length];
    localStorage.setItem(hintsKey, mode);
    applyControllerMode();
    queueMicrotask(applyControllerMode);
  });
  const dialog = document.querySelector("#controller-menu");
  const actions = [...dialog.querySelectorAll(".controller-menu-actions button")];
  let previousFocus = null;
  function toggle() {
    if (dialog.open) {
      dialog.close();
      return;
    }
    // Do not cover another modal or interrupt a confirmation already in progress.
    if (document.querySelector("dialog[open]")) return;
    previousFocus = document.activeElement;
    actions[0].disabled = !canRestart();
    actions[3].disabled = !canExit;
    actions[3].title = canExit ? "" : "Exit is available in the desktop app; close the browser tab instead.";
    dialog.showModal();
    actions.find((button) => !button.disabled)?.focus();
  }
  dialog.addEventListener("close", () => {
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  });
  document.querySelector("#controller-menu-close").addEventListener("click", () => dialog.close());
  for (const [index, action] of [restart, library, settings, exit].entries()) {
    actions[index].addEventListener("click", async () => {
      dialog.close();
      try { await action(); }
      catch (error) { onError(error); }
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "F10" || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!event.repeat) toggle();
  }, true);

  let frame = null;
  const held = new Map();
  function poll() {
    frame = null;
    const connected = new Set();
    for (const pad of navigator.getGamepads()) {
      if (!pad?.connected || pad.mapping !== "standard") continue;
      connected.add(pad.index);
      const previous = held.get(pad.index) ?? new Set();
      const pressed = new Set(pad.buttons.flatMap((button, index) => button.pressed ? [index] : []));
      held.set(pad.index, pressed);
      const down = (button) => pressed.has(button) && !previous.has(button);
      if (down(9)) {
        toggle();
        continue;
      }
      const modal = document.activeElement?.closest("dialog[open]")
        ?? document.querySelector("dialog[open]")
        ?? document.querySelector(".screen.is-active .era-dialog:popover-open");
      if (!modal) {
        if (down(3)) onY();
        if (down(2)) onX();
        if (down(1)) activateMapBack();
        if (down(4)) activateMapTab(-1);
        if (down(5)) activateMapTab(1);
        continue;
      }
      for (const [button, selector] of [[4, ".era-page-prev:enabled"], [5, ".era-page-next:enabled"]]) {
        if (!down(button)) continue;
        const page = modal.querySelector(selector);
        if (page && !page.closest("[hidden], [inert]") && page.getClientRects().length) {
          page.focus({ preventScroll: true });
          page.click();
        }
      }
      // Only consume the standard D-pad, confirm and back buttons while a dialog is open.
      const keys = [[12, "ArrowUp"], [13, "ArrowDown"], [14, "ArrowLeft"], [15, "ArrowRight"], [1, "Escape"]];
      for (const [button, key] of keys) {
        if (down(button) && !adjustControllerRange(document.activeElement, key)) (document.activeElement ?? modal).dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      }
      if (down(0)) {
        const focused = document.activeElement;
        if (modal.contains(focused) && activateNavigationControl(focused)) continue;
        if (focused?.matches('button:enabled, a[href], input[type="checkbox"]:enabled, input[type="radio"]:enabled')
          && modal.contains(focused)) focused.click();
      }
    }
    for (const index of held.keys()) if (!connected.has(index)) held.delete(index);
    detected = connected.size > 0;
    applyControllerMode();
    if (connected.size) frame = requestAnimationFrame(poll);
  }
  function start() {
    if (frame === null && !document.hidden && typeof navigator.getGamepads === "function")
      frame = requestAnimationFrame(poll);
  }
  window.addEventListener("gamepadconnected", start);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    } else start();
  });
  window.addEventListener("pagehide", () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });
  start();
  return {
    reset() {
      localStorage.removeItem(hintsKey);
      localStorage.removeItem("era-typescript.force-controller");
      mode = "auto";
      applyControllerMode();
    },
  };
}
import { activateNavigationControl, adjustControllerRange, setCheckboxState } from "./controls.js";
