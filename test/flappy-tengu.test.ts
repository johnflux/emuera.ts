import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { GAMES_DIR, isGameRoot, loadGame } from "../src/loader.js";
import { compatibility } from "../src/compatibility.js";
import { Runtime, type Snapshot } from "../src/runtime.js";

const root = path.join(GAMES_DIR, "eraflappytengu");
test("unmodified FlappyTengu renders, starts playing, pauses unfocused and resumes", { skip: !isGameRoot(root) }, async () => {
  const game = await loadGame(root);
  const report = compatibility(game);
  assert.deepEqual(report.gaps, []);
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.recognizedInstructions, report.instructions);
  for (const jit of [false, true]) {
    const run = new Runtime(game, 50_000, { jit, client: { width: 1200, height: 800, active: true } });
    const start = run.start();
    assert.equal(start.status, "waiting", JSON.stringify(start.error));
    assert.equal(start.input?.kind, "mousekey");
    const picture = start.cbg?.[0]?.picture;
    assert.ok(picture);
    assert.deepEqual([picture.width, picture.height], [1200, 800]);
    assert.ok(picture.ops.some((op) => op.op === "text" && op.text === "Click to play"));
    const playing = run.input(JSON.stringify({ result: [1, 0x100000, 10, -10, -1, 0] }));
    assert.equal(playing.status, "waiting", JSON.stringify(playing.error));
    assert.equal(playing.input?.kind, "mousekey");
    run.setClient({ width: 1200, height: 800, active: false });
    const paused = run.timeout();
    assert.equal(paused.status, "waiting", JSON.stringify(paused.error));
    assert.equal(paused.input?.blocking, true);
    assert.equal(paused.input?.timeout, 1);
    assert.equal(run.timeout().status, "waiting");
    run.setClient({ width: 1200, height: 800, active: true });
    const resumed = run.timeout();
    assert.equal(resumed.status, "waiting", JSON.stringify(resumed.error));
    assert.equal(resumed.input?.kind, "mousekey");
    const exited = run.input(JSON.stringify({ result: [3, 27, 0, 0, 0, 0] }));
    assert.equal(exited.status, "waiting", JSON.stringify(exited.error));
    assert.equal(exited.input?.kind, "integer");
    assert.ok(exited.output.some((item) => item.type === "text" && item.text === "Thank you for playing eraFlappyTengu!"));
    const restarted = run.input("0");
    assert.equal(restarted.status, "waiting", JSON.stringify(restarted.error));
    assert.equal(restarted.input?.kind, "mousekey");
    assert.ok(restarted.cbg?.[0]?.picture.ops.some((op) => op.op === "text" && op.text === "Click to play"));
  }
});

test("FlappyTengu falls between frames and a click makes the character flap upward", { skip: !isGameRoot(root) }, async (t) => {
  const game = await loadGame(root);
  let now = 100000;
  t.mock.method(Date, "now", () => now);
  const y = (snapshot: Snapshot): number => {
    assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
    const sprite = snapshot.cbg?.[0]?.picture.ops.find((op) => op.op === "image" && op.url.includes("29_"));
    assert.ok(sprite && sprite.op === "image");
    return sprite.dest[1];
  };
  for (const jit of [false, true]) {
    const run = new Runtime(game, 50_000, { jit, client: { width: 1200, height: 800, active: true } });
    assert.equal(y(run.start()), 0);
    const click = () => {
      now += 30;
      return run.input(JSON.stringify({ result: [1, 0x100000, 10, -10, -1, 0] }));
    };
    click();
    let falling = 0;
    for (let frame = 0; frame < 5; frame++) {
      now += 30;
      falling = y(run.timeout());
    }
    assert.ok(falling > 0, "gravity should move the character down");
    const beforeFlap = y(click());
    now += 30;
    const afterFlap = y(run.timeout());
    assert.ok(afterFlap < beforeFlap, `flap should move upward: ${afterFlap} < ${beforeFlap}`);
  }
});
