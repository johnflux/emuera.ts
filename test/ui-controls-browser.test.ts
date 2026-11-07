import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const browser = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google/Chrome/Application/chrome.exe"),
].find((path): path is string => !!path && existsSync(path));

test("native game checkboxes share clear styling and preserve runtime state on activation", {
  skip: browser ? false : "Chrome/Chromium not found; set CHROME_PATH",
}, async () => {
  const [controls, style, handheld] = await Promise.all([
    readFile(new URL("../web/controls.js", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/style.css", import.meta.url), "utf8"),
    readFile(new URL("../web/generated/handheld.css", import.meta.url), "utf8"),
  ]);
  const html = `<!doctype html><meta charset="utf-8"><style>${style}\n${handheld}</style>
    <body><section class="screen is-active"><div class="line" id="controls"></div></section><script>
      ${controls.replace(/^export /gm, "")}
      let calls = 0;
      const unchecked = createCheckbox(false, () => calls++);
      const checked = createCheckbox(true, () => calls++);
      for (const [label, text] of [[unchecked, "Auto-Clean"], [checked, "Petting"]]) {
        label.classList.add("choice", "era-toggle");
        label.querySelector("span").textContent = text;
        document.getElementById("controls").append(label);
      }
      checked.classList.add("era-kind-petting");
      const appearance = label => {
        const style = getComputedStyle(label);
        return { border: style.borderColor, background: style.backgroundColor,
          before: style.content, height: label.getBoundingClientRect().height };
      };
      const off = appearance(unchecked), on = appearance(checked);
      unchecked.click();
      checked.click();
      const activated = calls;
      const states = [choiceControl(unchecked).checked, choiceControl(checked).checked];
      choiceControl(unchecked).disabled = true;
      unchecked.click();
      const disabledCalls = calls;
      const clone = checked.cloneNode(true);
      const clonedState = choiceControl(clone).checked;
      document.body.classList.add("is-handheld");
      const handheldHeight = appearance(checked).height;
      document.body.innerHTML = "<pre id='result'>" + JSON.stringify({
        off, on, activated, states, disabledCalls, clonedState, handheldHeight,
        nestedButtons: checked.querySelectorAll("button").length
      }) + "</pre>";
    </script>`;
  const profile = await mkdtemp(join(tmpdir(), "era-checkboxes-"));
  try {
    const args = ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${profile}`,
      "--window-size=1200,700", "--dump-dom", `data:text/html;base64,${Buffer.from(html).toString("base64")}`];
    if (process.platform === "linux") args.unshift("--no-sandbox");
    const { stdout } = await execute(browser!, args, { maxBuffer: 4 * 1024 * 1024, timeout: 20000 });
    const match = stdout.match(/<pre id="result">([^]*?)<\/pre>/);
    assert.ok(match, stdout);
    const result = JSON.parse(match[1]);
    assert.notEqual(result.off.border, result.on.border);
    assert.notEqual(result.off.background, result.on.background);
    assert.equal(result.on.border, "rgb(192, 96, 154)");
    assert.equal(result.activated, 2, "label activation sends one command per checkbox");
    assert.deepEqual(result.states, [false, true], "preventDefault keeps authoritative state");
    assert.equal(result.disabledCalls, 2, "disabled checkboxes send no command");
    assert.equal(result.clonedState, true, "render staging clones keep the check");
    assert.equal(result.nestedButtons, 0);
    assert.ok(result.handheldHeight >= 40, `handheld height: ${result.handheldHeight}`);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
