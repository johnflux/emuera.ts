import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compile } from "sass";

test("served CSS assets match the current Sass sources", () => {
  for (const name of ["style", "handheld", "library", "art-demo"]) {
    const source = new URL(`../styles/${name}.scss`, import.meta.url);
    const output = new URL(`../web/generated/${name}.css`, import.meta.url);
    assert.equal(readFileSync(output, "utf8"), `${compile(fileURLToPath(source)).css}\n`, `${name}.css is stale; run npm run build:css`);
  }
});
