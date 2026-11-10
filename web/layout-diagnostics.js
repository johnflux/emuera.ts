const MAIN_PANELS = ["era-main-header", "era-main-left", "era-main-center", "era-main-right"];
const SIDE_PANELS = ["era-main-left", "era-main-right"];
const LIMIT = 80;

/** Local structural diagnostics; intentionally excludes narrative, HTML contents and save data. */
export function createLayoutDiagnostics() {
  const operations = [];
  const pending = new Map();
  const seen = new Set();
  function record(operation) {
    operations.push(String(operation).slice(0, 200));
    if (operations.length > LIMIT) operations.shift();
  }
  function issue(code, detail) {
    detail = String(detail).slice(0, 240);
    const key = `${code}: ${detail}`;
    if (!pending.has(key) && pending.size < 20) pending.set(key, { code, detail });
  }
  function abandon(screen) {
    for (const box of screen.querySelectorAll(".era-layout, .era-dialog")) {
      if (!box.dataset.closed) issue("abandoned-layout", `Screen advanced with ${box.className} still open`);
    }
  }
  function inspect(root, context) {
    const boxes = [...root.querySelectorAll(".era-box")];
    for (const box of boxes) {
      const parent = box.parentElement;
      const inSidebar = SIDE_PANELS.some(name => box.classList.contains(name))
        && parent?.classList.contains("era-main-sidebar") && parent.parentElement?.classList.contains("era-main");
      const sharedHeader = box.classList.contains("era-main-header")
        && (parent?.classList.contains("era-shop") || parent?.classList.contains("era-sky-dialog"));
      if (MAIN_PANELS.some(name => box.classList.contains(name))
        && !parent?.classList.contains("era-main") && !inSidebar && !sharedHeader)
        issue("misplaced-panel", `${box.className} is outside its expected main, sidebar or shared header container`);
      if (!box.classList.contains("era-main") || box.dataset.closed !== "closed") continue;
      const panels = [...box.children];
      for (const child of box.children) {
        if (child.classList.contains("era-main-sidebar"))
          panels.push(...[...child.children].filter(panel => SIDE_PANELS.some(name => panel.classList.contains(name))));
      }
      for (const name of MAIN_PANELS) {
        const count = panels.filter(child => child.classList.contains(name)).length;
        if (count !== 1) issue("incomplete-main", `Completed era-main has ${count} ${name} panels; expected 1`);
      }
    }
    const fresh = [...pending].filter(([key]) => !seen.has(key));
    pending.clear();
    if (!fresh.length) return null;
    for (const [key] of fresh) {
      seen.add(key);
      if (seen.size > LIMIT) seen.delete(seen.values().next().value);
    }
    const tree = boxes.slice(-LIMIT).map(box => {
      let depth = 0;
      for (let parent = box.parentElement; parent && parent !== root; parent = parent.parentElement) depth++;
      return `${"  ".repeat(Math.min(depth, 12))}${box.className.slice(0, 200)} [${box.dataset.closed || "open"}]`;
    });
    return [
      "Layout problem detected",
      `Game: ${String(context.game).slice(0, 120)} | Title: ${String(context.title).slice(0, 160)}`,
      `Step: ${context.step ?? "unknown"} | Input: ${context.input ?? "none"} | Status: ${context.status}`,
      ...fresh.map(([, item]) => `${item.code}: ${item.detail}`),
      "Recent renderer operations (oldest first):", ...operations,
      `Layout tree (last ${LIMIT} boxes):`, ...tree,
    ].join("\n");
  }
  return {
    record, issue, abandon, inspect,
    reset() { operations.length = 0; pending.clear(); seen.clear(); },
  };
}
