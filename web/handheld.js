const HANDHELD_KEY = "era-typescript.handheld";
const EDITABLE = "input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]:not([contenteditable='false'])";
const CONTROLS = "button:enabled, a[href], input:enabled, select:enabled, textarea:enabled";

export function touchInput() {
  return globalThis.matchMedia?.("(any-pointer: coarse)").matches === true;
}

export function navigationRect(element) {
  const control = element.closest(".print-cell, .era-guard-control") ?? element;
  const rect = control.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function decorateCommandNumbers(element) {
  if (!element.matches("button.choice") || element.querySelector(".command-number")) return;
  const value = element.dataset.value;
  if (!/^-?\d+$/.test(value ?? "")) return;
  const text = element.textContent;
  const markers = [...text.matchAll(/\[\s*(-?\d+)\s*\]/g)].filter((match) => BigInt(match[1]) === BigInt(value));
  const label = element.closest(".print-cell, .era-guard-control")?.textContent ?? text;
  if (!markers.length || !label.replace(/\[\s*-?\d+\s*\]/g, "").trim()) return;
  if (!text.replace(/\[\s*-?\d+\s*\]/g, "").trim()) {
    element.classList.add("command-number-only");
    element.setAttribute("aria-label", label.replace(/\[\s*-?\d+\s*\]/g, "").trim());
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    nodes.push({ node, start: offset, end: offset + node.textContent.length });
    offset += node.textContent.length;
  }
  for (const match of markers.reverse()) {
    const start = nodes.find((entry) => entry.start <= match.index && entry.end > match.index);
    const endOffset = match.index + match[0].length;
    const end = nodes.find((entry) => entry.start < endOffset && entry.end >= endOffset);
    const range = document.createRange();
    range.setStart(start.node, match.index - start.start);
    range.setEnd(end.node, endOffset - end.start);
    const number = document.createElement("span");
    number.className = "command-number";
    number.append(range.extractContents());
    range.insertNode(number);
  }
}

export function setupHandheld(onChange) {
  const toggle = document.querySelector("#handheld-toggle");
  const saved = localStorage.getItem(HANDHELD_KEY);
  let enabled = saved === null
    ? globalThis.eraDesktop?.handheld === true || touchInput() || (globalThis.navigator?.maxTouchPoints ?? 0) > 0
    : saved === "1";
  function apply() {
    document.body.classList.toggle("is-handheld", enabled);
    toggle.checked = enabled;
  }
  apply();
  toggle.addEventListener("click", () => {
    enabled = !enabled;
    localStorage.setItem(HANDHELD_KEY, enabled ? "1" : "0");
    apply();
    onChange();
  });
  return { enabled: () => enabled };
}

export function directionalTarget(rects, current, key) {
  if (current < 0) return key === "ArrowUp" || key === "ArrowLeft" ? rects.length - 1 : 0;
  const origin = rects[current];
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  let best = -1;
  let bestRank = null;
  for (let index = 0; index < rects.length; index++) {
    if (index === current) continue;
    const candidate = rects[index];
    const dx = candidate.left + candidate.width * .2 - (origin.left + origin.width * .2);
    const dy = candidate.top + candidate.height / 2 - (origin.top + origin.height / 2);
    const forward = (horizontal ? dx : dy) * sign;
    if (forward <= 1) continue;
    const rowOverlap = Math.min(origin.top + origin.height, candidate.top + candidate.height)
      - Math.max(origin.top, candidate.top);
    const sameRow = rowOverlap > Math.min(origin.height, candidate.height) / 2;
    if (!horizontal && sameRow) continue;
    const gap = horizontal
      ? sign > 0 ? candidate.left - origin.left - origin.width : origin.left - candidate.left - candidate.width
      : sign > 0 ? candidate.top - origin.top - origin.height : origin.top - candidate.top - candidate.height;
    if (horizontal && !sameRow && gap < -1) continue;
    const crossGap = horizontal ? 0 : Math.max(0,
      candidate.left - origin.left - origin.width, origin.left - candidate.left - candidate.width);
    const anchor = origin.left + origin.width * .2;
    const anchorGap = Math.max(0, candidate.left - anchor, anchor - candidate.left - candidate.width);
    const rank = horizontal
      ? [sameRow ? 0 : 1, sameRow ? Math.max(0, gap) : Math.abs(dy), Math.abs(dx), forward]
      : [crossGap === 0 ? 0 : 1, Math.max(0, gap), anchorGap, Math.abs(dx), forward];
    const firstDifference = bestRank && rank.findIndex((value, axis) =>
      Math.abs(value - bestRank[axis]) > (axis === 0 ? 0 : 1));
    if (!bestRank || firstDifference >= 0 && rank[firstDifference] < bestRank[firstDifference]) {
      best = index;
      bestRank = rank;
    }
  }
  return best;
}

export function setupKeyboardNavigation({ terminal, command, canNavigate }) {
  let usingChoices = false;
  let inputWasHidden = null;
  let pageAction = null;
  const tabGroups = [".era-start-tabs", ".era-player-tabs", ".era-sheet-pages", ".era-sheet-subpages", ".era-move-tabs"];
  let tabAction = null;
  function activeDialog() {
    return document.activeElement?.closest("dialog[open]") ?? document.querySelector("dialog[open]");
  }
  function scope() {
    return activeDialog()
      ?? terminal.querySelector(".screen.is-active .era-dialog:popover-open")
      ?? document.querySelector("#menu-panel:not([hidden])")
      ?? (document.body.classList.contains("is-home")
        ? document.querySelector("#library") : terminal.querySelector(".screen.is-active"));
  }
  function controls(root) {
    return [...(root?.querySelectorAll(CONTROLS) ?? [])].filter((element) => {
      if (element.tabIndex < 0 || element.closest("[hidden], [inert], .is-stale")) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none"
        && element.getClientRects().length > 0;
    });
  }
  document.addEventListener("pointerdown", () => { usingChoices = false; }, true);
  document.addEventListener("click", (event) => {
    const page = event.target.closest(".era-page-prev, .era-page-next");
    pageAction = page ? page.matches(".era-page-prev") ? ".era-page-prev" : ".era-page-next" : null;
    const tab = event.target.closest("button[data-value]");
    const group = tab && tabGroups.find((selector) => tab.closest(selector));
    tabAction = group ? { group, value: tab.dataset.value } : null;
  }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target.closest(EDITABLE)) usingChoices = false;
  });
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target;
    if (event.key === "Escape") {
      const dialog = activeDialog();
      if (dialog) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dialog.close("");
      } else if (target === command && !terminal.querySelector(".era-dialog:popover-open")
        && document.querySelector("#menu-panel").hidden) {
        event.preventDefault();
        terminal.focus({ preventScroll: true });
      }
      return;
    }
    const touchCommand = target === command && (touchInput() || document.body.classList.contains("is-handheld"))
      && (event.key === "ArrowUp" || event.key === "ArrowDown");
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
      || target.closest(EDITABLE) && !touchCommand || target.closest("[role=tablist]")) return;
    pageAction = null;
    tabAction = null;
    const root = scope();
    if (!root || root.closest("#terminal") && !canNavigate()) return;
    const items = controls(root);
    const gameScreen = root === terminal.querySelector(".screen.is-active");
    if (gameScreen && !command.disabled && !command.closest("[hidden]")) items.push(command);
    if (!items.length) return;
    const rects = items.map(navigationRect);
    const next = directionalTarget(rects, items.indexOf(document.activeElement), event.key);
    event.preventDefault();
    if (next < 0) return;
    usingChoices = root.closest("#terminal") !== null;
    items[next].focus({ preventScroll: true });
    items[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  }, true);
  return {
    focusInput() {
      if (activeDialog()) return;
      const hiddenInput = command.closest("[hidden]") !== null;
      const inputAppeared = inputWasHidden === true && !hiddenInput;
      inputWasHidden = hiddenInput;
      if (inputAppeared) usingChoices = false;
      const root = scope();
      if (hiddenInput && root === terminal.querySelector(".screen.is-active") && root?.querySelector(".era-launch-actions")) {
        if (!document.activeElement?.closest(".era-launch-actions button.choice:enabled")) terminal.focus({ preventScroll: true });
        return;
      }
      const items = usingChoices || hiddenInput ? controls(root) : [];
      const next = items.find((element) => pageAction && element.matches(pageAction))
        ?? items.find((element) => tabAction && element.closest(tabAction.group) && element.dataset.value === tabAction.value)
        ?? items.find((element) => element.matches(".era-load .era-save-slot")) ?? items[0];
      (next ?? (hiddenInput ? terminal : command)).focus({ preventScroll: true });
    },
  };
}
