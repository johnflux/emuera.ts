import { readFileSync } from "node:fs";

// Legacy declaration tests inspect the original source formatting. Browser tests
// exercise the compiled CSS; new tests should prefer computed behavior.
export function styleSource(name: "style" | "handheld" | "library"): string {
  const entry = readFileSync(new URL(`../styles/${name}.scss`, import.meta.url), "utf8");
  if (name === "library") return entry;
  return [...entry.matchAll(/^@use "([^"]+)";$/gm)]
    .map(([, path]) => {
      const slash = path.lastIndexOf("/");
      const partial = `${path.slice(0, slash + 1)}_${path.slice(slash + 1)}.scss`;
      return readFileSync(new URL(`../styles/${partial}`, import.meta.url), "utf8");
    }).join("");
}
