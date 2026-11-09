import { readFileSync } from "node:fs";

// Legacy declaration tests inspect the original source formatting. Browser tests
// exercise the compiled CSS; new tests should prefer computed behavior.
export function styleSource(name: "style" | "responsive" | "library"): string {
  function source(url: URL): string {
    return readFileSync(url, "utf8").replace(/^@use "([^"]+)";$/gm, (_, path: string) => {
      const slash = path.lastIndexOf("/");
      const partial = `${path.slice(0, slash + 1)}_${path.slice(slash + 1)}.scss`;
      return source(new URL(partial, url));
    });
  }
  return source(new URL(`../styles/${name}.scss`, import.meta.url));
}
