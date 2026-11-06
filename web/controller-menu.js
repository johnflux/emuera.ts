export function setupControllerMenu({ restart, library, settings, exit, canRestart, canExit, onError }) {
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
      const modal = document.activeElement?.closest("dialog[open]") ?? document.querySelector("dialog[open]");
      if (!modal) continue;
      // Only consume the standard D-pad, confirm and back buttons while a modal is open.
      const keys = [[12, "ArrowUp"], [13, "ArrowDown"], [14, "ArrowLeft"], [15, "ArrowRight"], [1, "Escape"]];
      for (const [button, key] of keys) {
        if (down(button)) (document.activeElement ?? modal).dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      }
      if (down(0)) {
        const focused = document.activeElement;
        if (focused?.matches("button:enabled, a[href]") && modal.contains(focused)) focused.click();
      }
    }
    for (const index of held.keys()) if (!connected.has(index)) held.delete(index);
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
}
