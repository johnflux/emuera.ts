import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { once } from "node:events";
import { compatibility } from "../src/compatibility.js";
import { emptyGame, indexScript, loadGame, type Game } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { createApp } from "../src/server.js";

function runtime(source: string, jit = true, game = emptyGame()): Runtime {
  indexScript(game, source, "fixture.ERB");
  return new Runtime(game, 50_000, { jit });
}
function texts(snapshot: Snapshot): string[] {
  assert.notEqual(snapshot.status, "error", JSON.stringify(snapshot.error));
  return snapshot.output.flatMap((item) => "text" in item ? [item.text] : []);
}

test("BINPUT accepts only retained button values, including keyboard input, defaults and cleared lines", () => {
  for (const jit of [false, true]) {
    const r = runtime(`@SYSTEM_TITLE
FOR A, 0, 3
  CALL MENU
NEXT
RETURN
@MENU
PRINTL [01] First
HTML_PRINT "<button value='2'>Second</button>"
PRINTBUTTON "Third", 3
BINPUT
PRINTFORML selected={RESULT}`, jit);
    for (let i = 0, snapshot = r.start(); i < 3; i++) {
      assert.equal(snapshot.input?.kind, "integer");
      assert.deepEqual(snapshot.input?.buttonValues, ["1", "2", "3"]);
      assert.throws(() => r.input("4"), /displayed button/);
      assert.throws(() => r.input("bad"), /whole number/);
      snapshot = r.input("01");
      assert.ok(texts(snapshot).includes("selected=1"));
    }
    const s = runtime(`@SYSTEM_TITLE
BINPUT 99
PRINTFORML {RESULT}
BINPUTS "fallback"
PRINTSL RESULTS
PRINTL [1] removed
CLEARLINE 1
PRINTL [2] kept
BINPUT`, jit).start();
    assert.deepEqual(texts(s).slice(0, 2), ["99", "fallback"]);
    assert.deepEqual(s.input?.buttonValues, ["2"]);
    assert.match(runtime("@SYSTEM_TITLE\nPRINTPLAIN [1] not a button\nBINPUT", jit).start().error?.message ?? "", /requires a displayed button/);
    const missing = runtime("@SYSTEM_TITLE\nBINPUT", jit).start();
    assert.match(missing.error?.message ?? "", /requires a displayed button/);
    const string = runtime(`@SYSTEM_TITLE
HTML_PRINT "<button value='a&amp;b'>A</button>"
BINPUTS
PRINTSL RESULTS`, jit);
    assert.deepEqual(string.start().input?.buttonValues, ["a&b"]);
    assert.throws(() => string.input("a"), /displayed button/);
    assert.deepEqual(texts(string.input("a&b")), ["a&b", "a&b"]);
  }
});

test("INPUTANY preserves the other result channel and SETTEXTBOX/GETTEXTBOX share state", () => {
  for (const jit of [false, true]) {
    const r = runtime(`@SYSTEM_TITLE
RESULTS = unchanged
SETTEXTBOX "draft"
PRINTSL GETTEXTBOX()
INPUTANY
PRINTFORML {RESULT} %RESULTS% [%GETTEXTBOX()%]
INPUTANY
PRINTFORML {RESULT} %RESULTS%`, jit);
    const first = r.start();
    assert.equal(first.textbox, "draft");
    assert.equal(first.input?.kind, "any");
    assert.deepEqual(texts(first), ["draft"]);
    assert.deepEqual(texts(r.input("42")), ["42", "42 unchanged []"]);
    assert.deepEqual(texts(r.input("command")), ["command", "42 command"]);
  }
});

test("function enumeration is case-insensitive, excludes events, truncates outputs, and works as a statement or expression", () => {
  const r = runtime(`@SYSTEM_TITLE
#DIMS SMALL, 1
ENUMFUNCBEGINSWITH "mod_"
PRINTFORML {RESULT} %RESULTS:0% %RESULTS:1%
PRINTFORML {ENUMFUNCBEGINSWITH("MOD_", SMALL)} %SMALL%
PRINTFORML {ENUMFUNCBEGINSWITH("")} {ENUMFUNCBEGINSWITH("EVENT")}
ENUMFUNCENDSWITH "_second"
PRINTFORML {RESULT} %RESULTS:0%
PRINTFORML {ENUMFUNCWITH("d_f", SMALL)} %SMALL%
PRINTFORML {ENUMFUNCENDSWITH("", SMALL)} {ENUMFUNCWITH("missing")}
RETURN
@mod_first
@mod_second
@EVENTFIRST`);
  assert.deepEqual(texts(r.start()), ["2 mod_first mod_second", "1 mod_first", "0 0", "1 mod_second", "1 mod_first", "0 0"]);
});

test("ENUMFILES supports wildcards, recursion, case-insensitive paths and output arrays without following links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-enum-"));
  try {
    await mkdir(path.join(root, "resources", "Nested"), { recursive: true });
    await writeFile(path.join(root, "resources", "Face.PNG"), "");
    await writeFile(path.join(root, "resources", "other.txt"), "");
    await writeFile(path.join(root, "resources", "Nested", "Face2.png"), "");
    await symlink(path.join(root, "resources"), path.join(root, "resources", "loop"));
    const game = emptyGame(root);
    const s = runtime(`@SYSTEM_TITLE
#DIMS FOUND, 1
PRINTFORML {ENUMFILES("RESOURCES", "*.png")} %RESULTS:0%
ENUMFILES "resources", "*.png", 1
PRINTFORML {RESULT} %RESULTS:0% %RESULTS:1%
PRINTFORML {ENUMFILES("resources", "*.*", 1, FOUND)} %FOUND%
PRINTFORML {ENUMFILES("missing")} {ENUMFILES("resources", "*.missing")}`, true, game).start();
    assert.deepEqual(texts(s), [
      "1 resources\\Face.PNG", "2 resources\\Face.PNG resources\\Nested\\Face2.png",
      "1 resources\\Face.PNG", "-1 0",
    ]);
    assert.match(runtime('@SYSTEM_TITLE\nENUMFILES "../"', true, emptyGame(root)).start().error?.message ?? "", /within the game directory/);
    await symlink(tmpdir(), path.join(root, "outside"));
    assert.match(runtime('@SYSTEM_TITLE\nENUMFILES "outside"', true, emptyGame(root)).start().error?.message ?? "", /outside the game directory/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MAP_GETKEYS supports joined, RESULTS and referenced outputs and MAP_REMOVE reports missing keys/maps", () => {
  const s = runtime(`@SYSTEM_TITLE
#DIMS KEYS, 3
MAP_CREATE "m"
MAP_SET "m", "b", "B"
MAP_SET "m", "a", "A"
PRINTSL MAP_GETKEYS("m")
MAP_GETKEYS "m", 1
PRINTFORML {RESULT} %RESULTS:0% %RESULTS:1%
MAP_GETKEYS "m", KEYS, 1
PRINTFORML {RESULT} %KEYS:0% %KEYS:1%
PRINTFORML {MAP_REMOVE("m", "a")} {MAP_REMOVE("m", "a")} {MAP_REMOVE("missing", "a")}
PRINTSL MAP_GETKEYS("m")
PRINTSL MAP_GETKEYS("missing")`).start();
  assert.deepEqual(texts(s), ["b,a", "2 b a", "2 b a", "1 0 -1", "b", ""]);
});

test("ERDNAME preserves original spelling and dimension tables; GETNUMB, MAP_TOXML and STRFORM evaluate real data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-erd-name-"));
  try {
    await mkdir(path.join(root, "ERB"));
    await mkdir(path.join(root, "CSV"));
    await writeFile(path.join(root, "ERB", "Custom.ERD"), "0,FirstName\n1,\n2,SecondName");
    await writeFile(path.join(root, "ERB", "Custom@2.ERD"), "3,DimensionName");
    const game = await loadGame(root);
    const s = runtime(`@SYSTEM_TITLE
#DIM Custom, 5
PRINTSL ERDNAME(Custom, 0)
PRINTFORML [%ERDNAME(Custom:4, 1)%] [%ERDNAME(Custom, -1)%] [%ERDNAME(RESULT, 0)%]
PRINTSL ERDNAME(Custom, 3, 2)
PRINTFORML {GETNUMB("Custom", "SecondName")} {GETNUMB("Custom", "missing")} {GETNUM(Custom, "DimensionName", 2)}
MAP_CREATE "m"
MAP_SET "m", "a&b", "<value>"
PRINTSL MAP_TOXML("m")
PRINTSL STRFORM("value={2+3}")
PRINTSL STRFORM("first\\nsecond")`, true, game).start();
    assert.deepEqual(texts(s), [
      "FirstName", "[] [] []", "DimensionName", "2 -1 3",
      "<map><p><k>a&amp;b</k><v>&lt;value&gt;</v></p></map>", "value=5", "first",
    ]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("HTML_STRINGLINES measures explicit breaks, Unicode cells, inline images and shape widths", () => {
  const game = emptyGame();
  game.sprites.set("ICON", { file: "x.png", width: 10, height: 10, x: 0, y: 0 });
  const s = runtime(`@SYSTEM_TITLE
PRINTFORML {HTML_STRINGLINES("", 4)} {HTML_STRINGLINES("AB<b>CD</b>E", 4)}
PRINTFORML {HTML_STRINGLINES("ab<br>cd<br>", 4)} {HTML_STRINGLINES("日本語", 4)}
PRINTFORML {HTML_STRINGLINES("<img src='ICON' width='200'>abc", 4)}
PRINTFORML {HTML_STRINGLINES("<shape type='space' param='200'>abc", 4)}`, true, game).start();
  assert.deepEqual(texts(s), ["0 2", "2 2", "2", "2"]);
  assert.match(runtime('@SYSTEM_TITLE\nHTML_STRINGLINES "x", 0').start().error?.message ?? "", /width must be positive/);
});

test("ARRAYMSORTEX sorts named targets and multidimensional rows, with direction, lengths and atomic validation", () => {
  for (const jit of [false, true]) {
    const source = `@SYSTEM_TITLE
#DIM SORTKEY, 5
#DIM DATA, 5, 2
#DIMS NAMES = "SORTKEY", "DATA"
SORTKEY = 3, 1, 2, 0, 9
DATA:0:0 = 30, 31
DATA:1:0 = 10, 11
DATA:2:0 = 20, 21
ARRAYMSORTEX SORTKEY, NAMES, 0
PRINTFORML {RESULT} {SORTKEY:0},{SORTKEY:1},{SORTKEY:2},{SORTKEY:4} {DATA:1:0},{DATA:1:1}
ARRAYMSORTEX "SORTKEY", NAMES, 1, 3
PRINTFORML {SORTKEY:0},{SORTKEY:1},{SORTKEY:2} {DATA:0:0},{DATA:0:1}`;
    assert.deepEqual(texts(runtime(source, jit).start()), ["1 3,2,1,9 20,21", "1,2,3 10,11"]);
    const s = runtime(`@SYSTEM_TITLE
#DIM K, 3
#DIM TOO_SMALL, 1
#DIMS NAMES = "K", "TOO_SMALL"
K = 3, 1, 2
ARRAYMSORTEX K, NAMES, 1, 3
PRINTFORML {RESULT} {K:0},{K:1},{K:2}`, jit).start();
    assert.deepEqual(texts(s), ["0 3,1,2"]);
  }
});

test("graphics pens, fonts, text and line drawing are captured in sprite pictures", () => {
  const s = runtime(`@SYSTEM_TITLE
GCREATE 1, 200, 100
GSETPEN 1, 0xFFFF0000, 2
GDRAWLINE 1, 1, 2, 30, 40
GSETBRUSH 1, 0xFF00FF00
GSETFONT 1, "monospace", 20, 3
GDRAWTEXT 1, "Hello", 5, 6
GGETTEXTSIZE "Hi", "monospace", 20
PRINTFORML {RESULT},{RESULT:1} %GGETFONT(1)% {GGETFONTSIZE(1)} {GGETFONTSTYLE(1)}
SPRITECREATE "TEXT", 1
PRINT_IMG "TEXT", 200, 100, -10`).start();
  assert.deepEqual(texts(s).slice(0, 1), ["20,20 monospace 20 3"]);
  const image = s.output.find((item) => item.type === "html");
  assert.ok(image && "sprites" in image);
  assert.match(image.text, /width='200' height='100' ypos='-10'/);
  const op = image.sprites!.TEXT!.picture.ops[0]!;
  assert.equal(op.op, "graphics");
  if (op.op !== "graphics") return;
  assert.deepEqual(op.source.ops, [
    { op: "line", color: "rgba(255, 0, 0, 1)", width: 2, from: [1, 2], to: [30, 40] },
    { op: "text", text: "Hello", color: "rgba(0, 255, 0, 1)", x: 5, y: 6, font: { name: "monospace", size: 20, style: 3 } },
  ]);
  assert.match(runtime('@SYSTEM_TITLE\nGCREATE 1, 10, 10\nGSETFONT 1, "x", 0').start().error?.message ?? "", /Graphics font/);
});

test("PRINT_IMG evaluates each argument once and supports resource color matrices and escaped names", () => {
  const game = emptyGame();
  game.sprites.set("A&B", { file: "x.png", width: 10, height: 10, x: 0, y: 0 });
  const s = runtime(`@SYSTEM_TITLE
#DIM MATRIX, 5, 5
FOR A, 0, 5
  MATRIX:A:A = 256
NEXT
A = 100
PRINT_IMG "A&B", A++, 100, 0
PRINTFORML {A}
PRINT_IMG "A&B", "A&B", MATRIX, 100, 100, 0`, true, game).start();
  assert.ok(texts(s).includes("101"));
  const images = s.output.filter((item) => item.type === "html");
  assert.equal(images.length, 2);
  assert.match(images[0]!.text, /width='100'/);
  const transformed = images[1]!;
  assert.ok("sprites" in transformed);
  assert.equal(transformed.sprites?.["A&B"]?.picture.ops[0]?.op, "image");
  const op = transformed.sprites?.["A&B"]?.picture.ops[0];
  assert.ok(op && op.op === "image" && op.matrix);
  assert.equal(op.matrix[0]?.[0], 1);
});

test("CBG button sprites carry hover pictures/tooltips and a separate live hit map, and clear independently", () => {
  const r = runtime(`@SYSTEM_TITLE
GCREATE 1, 10, 10
GCLEAR 1, 0xFFFF0000
SPRITECREATE "NORMAL", 1
GCREATE 2, 10, 10
GCLEAR 2, 0xFF0000FF
SPRITECREATE "HOVER", 2
GCREATE 3, 100, 100
GSETBRUSH 3, 0xFF00002A
GFILLRECTANGLE 3, 0, 0, 10, 10
CBGSETBUTTONSPRITE 42, "NORMAL", "HOVER", 0, -90, -1, "Help"
CBGSETBMAPG 3
INPUTMOUSEKEY
PRINTFORML {RESULT:4}
GCLEAR 1, 0xFF00FF00
GCLEAR 3, 0xFF000007
WAIT
CBGCLEARBUTTON
WAIT
CBGCLEAR
WAIT`);
  const first = r.start();
  assert.equal(first.cbg?.[0]?.buttonValue, 42);
  assert.equal(first.cbg?.[0]?.tooltip, "Help");
  assert.ok(first.cbg?.[0]?.hover);
  assert.equal(first.cbgMap?.ops.at(-1)?.op, "fill");
  const second = r.input(JSON.stringify({ result: [1, 0x100000, 1, -99, 42, 0] }));
  assert.deepEqual(texts(second), ["42"]);
  assert.ok(second.cbg);
  assert.notDeepEqual(second.cbgMap, first.cbgMap);
  assert.notDeepEqual(second.cbg, first.cbg);
  const third = r.input("");
  assert.deepEqual(third.cbg, []);
  assert.equal(third.cbgMap, undefined, "Clearing buttons must retain the hit map");
  assert.equal(r.input("").cbgMap, null);
});

test("bulk sprite disposal preserves resource sprites unless requested and is runtime-local", () => {
  const setup = (): Game => {
    const game = emptyGame();
    game.sprites.set("RESOURCE", { file: "x.png", x: 0, y: 0, width: 10, height: 10 });
    return game;
  };
  const game = setup();
  const source = `@SYSTEM_TITLE
GCREATE 1, 10, 10
SPRITECREATE "DYNAMIC", 1
PRINTFORML {SPRITEDISPOSEALL(0)} {SPRITECREATED("DYNAMIC")} {SPRITECREATED("RESOURCE")}
PRINTFORML {SPRITEDISPOSEALL(1)} {SPRITECREATED("RESOURCE")}
PRINTFORML {SPRITECREATE("RESOURCE", 1)} {SPRITECREATED("RESOURCE")}`;
  assert.deepEqual(texts(runtime(source, true, game).start()), ["1 0 1", "1 0", "1 1"]);
  assert.equal(game.sprites.size, 1);
  const disposed = runtime(`@SYSTEM_TITLE
SPRITEDISPOSEALL 1
HTML_PRINT "<img src='RESOURCE'>"`, true, setup()).start();
  const image = disposed.output.find((item) => item.type === "html");
  assert.ok(image && "sprites" in image && image.sprites?.RESOURCE);
  assert.deepEqual(image.sprites.RESOURCE.picture.ops, []);
});

test("library session resume retains textbox, tooltip and CBG hit-map state without overwriting later input", async () => {
  const game = emptyGame();
  indexScript(game, `@SYSTEM_TITLE
GCREATE 1, 10, 10
GCLEAR 1, 0xFF00002A
CBGSETBMAPG 1
TOOLTIP_CUSTOM 1
TOOLTIP_SETFONTSIZE 16
SETTEXTBOX "draft"
INPUTANY
INPUTANY`, "fixture.ERB");
  const app = createApp(game);
  try {
    app.listen(0, "127.0.0.1");
    await once(app, "listening");
    const address = app.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const post = async (route: string, data: unknown) => {
      const response = await fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const first = await post("/api/start", { mode: "game" });
    const restored = await post("/api/resume", { session: first.session });
    assert.equal(restored.textbox, "draft");
    assert.equal(restored.tooltip.fontSize, 16);
    assert.equal(restored.cbgMap.width, 10);
    assert.deepEqual(restored.cbgMap, first.cbgMap);
    await post("/api/input", { session: first.session, step: first.step, value: "submitted" });
    assert.equal((await post("/api/resume", { session: first.session })).textbox, "");
  } finally { await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve())); }
});

test("tooltip commands send actual settings and CALLSHARP stays explicitly unsupported", () => {
  const s = runtime(`@SYSTEM_TITLE
TOOLTIP_CUSTOM 1
TOOLTIP_SETFONT "monospace"
TOOLTIP_SETFONTSIZE 16
TOOLTIP_SETDELAY 50
TOOLTIP_SETDURATION 1000
TOOLTIP_SETCOLOR 0x112233, 0x445566
WAIT`).start();
  assert.deepEqual(s.tooltip, { custom: true, font: "monospace", fontSize: 16, delay: 50, duration: 1000, color: "#112233", background: "#445566" });
  const game = emptyGame();
  const r = runtime('@SYSTEM_TITLE\nCALLSHARP "plugin"', true, game);
  assert.match(r.start().error?.message ?? "", /native .NET plugin/);
  assert.deepEqual(compatibility(game).gaps.map((gap) => gap.feature), ["Instruction: CALLSHARP"]);
});

const blueRoot = path.resolve("GAMES/erablue_resort");
test("Blue Resort boots to its button-restricted title menu with only native plugin instructions unrecognized", {
  skip: !existsSync(blueRoot),
}, async () => {
  const game = await loadGame(blueRoot);
  assert.deepEqual(compatibility(game).gaps.map((gap) => gap.feature), ["Instruction: CALLSHARP"]);
  const r = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const snapshot = r.start();
  assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
  assert.deepEqual(snapshot.input?.buttonValues, ["0", "1", "99", "100"]);
  for (const choice of ["0", "0", "0"]) assert.equal(r.input(choice).status, "waiting");
});
