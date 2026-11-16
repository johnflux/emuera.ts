/** Shared observation and stale-reference checks for isolated QA and approved live access. */
export function installQaBridge({ state, resume }) {
  let nextRef = 0;
  const controls = new Map();
  function observe() {
    controls.clear();
    document.querySelectorAll("[data-era-qa-ref]").forEach(node => node.removeAttribute("data-era-qa-ref"));
    const current = state();
    const buttons = [];
    for (const element of document.querySelectorAll("button, input:not([type=hidden]), textarea, select, a[href], [role=button], [role=checkbox], [role=radio], [role=tab]")) {
      if (element.closest(".is-history, [hidden], [inert]")) continue;
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (!box.width || !box.height || style.visibility === "hidden" || style.display === "none") continue;
      const ref = `c${++nextRef}`;
      element.dataset.eraQaRef = ref;
      controls.set(ref, { element, session: current.session, step: current.step, render: current.render });
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      buttons.push({
        ref, tag: element.tagName.toLowerCase(), role: element.getAttribute("role"),
        name: element.getAttribute("aria-label") || element.innerText || element.getAttribute("title") || element.getAttribute("placeholder") || "",
        value: element.dataset.value ?? element.getAttribute("value"),
        disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
        reason: element.getAttribute("title") || element.getAttribute("aria-description") || null,
        bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
        inViewport: box.bottom > 0 && box.right > 0 && box.top < innerHeight && box.left < innerWidth,
        receivesPointer: hit === element || element.contains(hit),
        checked: element.getAttribute("aria-checked") ?? (element instanceof HTMLInputElement ? element.checked : null),
        options: element instanceof HTMLSelectElement ? [...element.options].map(option => ({ value: option.value, label: option.label, disabled: option.disabled })) : undefined,
      });
    }
    return {
      ...current, controls: buttons,
      text: document.body.innerText.slice(-100_000),
      layoutDiagnostics: document.querySelector(".layout-diagnostic:not([hidden]) pre")?.textContent ?? null,
      uiError: document.querySelector("#status.error")?.textContent ?? null,
      viewport: { width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio },
    };
  }
  window.eraQA = {
    state, observe, resume,
    validate(ref) {
      const entry = controls.get(ref), current = state();
      if (!entry || !entry.element.isConnected || current.busy || current.rendering || entry.session !== current.session
        || entry.step !== current.step || entry.render !== current.render)
        throw new Error("Stale control reference; call qa_observe again");
      if (entry.element.matches(":disabled") || entry.element.getAttribute("aria-disabled") === "true")
        throw new Error("Control is disabled");
      return true;
    },
    async act(action) {
      const element = action.ref ? controls.get(action.ref)?.element : document.activeElement;
      if (action.ref) this.validate(action.ref);
      if (action.kind === "scroll") {
        if (action.ref) {
          element.scrollIntoView({ block: "center", inline: "nearest" });
          let container = element;
          while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowY + getComputedStyle(container).overflowX))
            container = container.parentElement;
          (container ?? window).scrollBy(action.x, action.y);
        } else window.scrollBy(action.x, action.y);
      } else {
        if (!element || element === document.body) throw new Error("Choose a control reference first");
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        if (hit !== element && !element.contains(hit)) throw new Error("Control is offscreen or covered; scroll or close the covering dialog first");
        switch (action.kind) {
          case "click": element.click(); break;
          case "fill":
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.readOnly)
              throw new Error("Control is not an editable text field");
            element.focus();
            element.value = action.text;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          case "select": {
            if (!(element instanceof HTMLSelectElement)) throw new Error("Control is not a select");
            const option = [...element.options].find(option => option.value === action.value);
            if (!option || option.disabled || option.parentElement?.disabled) throw new Error("Option is unavailable");
            element.value = action.value;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
          case "press":
            if (action.key !== "Enter" && action.key !== "Space")
              throw new Error("Live mode supports Enter and Space only; use isolated mode for trusted keyboard input");
            element.focus();
            if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) element.click();
            else if (action.key === "Enter" && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
            else throw new Error("This control has no supported live keyboard action");
            break;
          case "hover": throw new Error("Live DOM events cannot produce a real CSS hover; use isolated graphical mode");
          default: throw new Error("Unknown live UI action");
        }
      }
      await this.ready();
    },
    async ready() {
      const deadline = performance.now() + 30_000;
      while (state().busy || state().rendering) {
        if (performance.now() > deadline) throw new Error("Game is still busy; observe again before acting");
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      await document.fonts.ready;
      await Promise.all([...document.images].filter(image => !image.complete).map(image => new Promise(resolve => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      })));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
  };
}
