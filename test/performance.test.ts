import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createApp } from "../src/server.js";
import { emptyGame, indexScript } from "../src/loader.js";

test("browser profiling is opt-in, bounded and returns independent snapshots", async () => {
  const source = (await readFile(new URL("../web/performance.js", import.meta.url), "utf8")).replace(/^export /gm, "");
  for (const enabled of [false, true]) {
    let time = 10;
    const api = runInNewContext(`${source}\n({ profileStart, profileEnd, profileReport, clearProfile });`, {
      URLSearchParams, location: { search: enabled ? "?profile" : "" }, structuredClone,
      performance: { now: () => time++ },
    });
    for (let i = 0; i < 2010; i++) api.profileEnd("test", api.profileStart(), { step: i });
    const samples = api.profileReport();
    assert.equal(samples.length, enabled ? 2000 : 0);
    if (enabled) {
      assert.equal(samples[0].step, 10);
      assert.equal(samples[0].ms, 1);
      samples[0].step = -1;
      assert.equal(api.profileReport()[0].step, 10);
    } else assert.equal(time, 10, "disabled profiling does not read the clock");
    api.clearProfile();
    assert.equal(api.profileReport().length, 0);
  }
});

test("profile requests separate interpreter execution, replay preparation and serialization without changing output", async () => {
  const game = emptyGame();
  indexScript(game, "@SYSTEM_TITLE\nPRINTL Ready\nINPUTS\nPRINTL Continued\nAWAIT 1\nPRINTL Done\nINPUT", "profile.erb");
  const app = createApp(game);
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  const address = app.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (route: string, data: unknown, profile: boolean) => fetch(base + route, {
    method: "POST", headers: { "Content-Type": "application/json", ...(profile ? { "X-Era-Profile": "1" } : {}) },
    body: JSON.stringify(data),
  });
  try {
    for (const profile of [false, true]) {
      const start = await post("/api/start", { mode: "game" }, profile);
      const state = await start.json();
      const input = await post("/api/input", { session: state.session, value: "private-profile-input" }, profile);
      const continued = await input.json();
      const timeout = await post("/api/timeout", { session: state.session }, profile);
      const final = await timeout.json();
      assert.equal(state.output[0].text, "Ready");
      assert.ok(continued.output.some((item: { text?: string }) => item.text === "Continued"));
      assert.ok(final.output.some((item: { text?: string }) => item.text === "Done"));
      for (const response of [start, input, timeout]) {
        assert.equal(response.headers.has("server-timing"), profile);
        assert.equal(response.headers.has("x-era-heap-bytes"), profile);
        if (profile) {
          const timings = response.headers.get("server-timing")!;
          for (const name of ["execute", "prepare", "serialize"]) assert.match(timings, new RegExp(`${name};dur=\\d+\\.\\d+`));
          assert.ok(Number(response.headers.get("x-era-heap-bytes")) > 0);
          assert.ok(!timings.includes("private-profile-input"));
        }
      }
    }
    const module = await fetch(base + "/performance.js");
    assert.equal(module.status, 200);
    assert.match(await module.text(), /profileReport/);
  } finally {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
});
