import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { demoGame } from "../src/demo.js";
import { applyHotpatches, emptyGame, GAME_ROOT, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime } from "../src/runtime.js";
import { readNativeSave } from "../src/save-format.js";
import { MemoryGlobalStore, MemorySaveStore } from "../src/storage.js";

async function withPatchDir(files: Record<string, string>, body: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "hotpatch-"));
  try {
    for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("plain button variants render one control, escape attributes and reject unknown styles", () => {
  const source = readFileSync(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8");
  const attributes = readFileSync(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8");
  assert.doesNotMatch(source, /era-guard-control/);
  const game = emptyGame();
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<attribute-helper>");
  indexScript(game, source.slice(source.indexOf("@HOTPATCH_BUTTON(")), "<button-helper>");
  const variants = ["default", "block", "primary", "list"];
  indexScript(game, `@SYSTEM_TITLE
${variants.map((variant, i) => `HTML_PRINT HOTPATCH_BUTTON("A&B <label>", ${i}, "It's <safe>", "${variant}")`).join("\n")}
HTML_PRINT HOTPATCH_BUTTON("Unavailable", 10, "", "default", "", "", "", 0)
HTML_PRINT HOTPATCH_BUTTON("Inventory", 805, "", "block", "", "", "", 1, "'&>")
BINPUT
@TEST_BAD_VARIANT
HTML_PRINT HOTPATCH_BUTTON("Bad", 0, "", "invented")`, "<button-test>");
  for (const jit of [false, true]) {
    const snapshot = new Runtime(game, undefined, { jit }).start();
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const buttons = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []);
    assert.equal(buttons.length, variants.length + 2);
    for (const [i, markup] of buttons.slice(0, variants.length).entries()) {
      assert.equal((markup.match(/<button\b/g) ?? []).length, 1);
      assert.match(markup, /A&amp;B &lt;label&gt;/);
      assert.match(markup, /title='It&#39;s &lt;safe&gt;'/);
      assert.match(markup, new RegExp(`class='era-button${i === 0 ? "" : ` era-button-${variants[i]}`} '`));
      assert.match(markup, new RegExp(`data-command-number='${i}'`));
      assert.doesNotMatch(markup, /class='command-number'|interactive-label/);
      assert.match(markup, /aria-disabled='false'/);
    }
    assert.match(buttons[4]!, /aria-disabled='true'/);
    assert.match(buttons[5]!, /data-suffix='&#39;&amp;&gt;'/);
    assert.doesNotMatch(buttons[5]!, /era-control-arrow|class='command-number'/);
    const bad = new Runtime(game, undefined, { jit }).start("TEST_BAD_VARIANT");
    assert.ok(bad.error);
    assert.match(JSON.stringify(bad.error), /Unknown button variant: invented/);
  }
});

test("custom commands use shared action buttons and retain availability and highlighted labels", () => {
  const source = readFileSync(new URL("../hotpatch/MAIN_SCREEN_COMMANDS.ERB", import.meta.url), "utf8");
  const attributes = readFileSync(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8");
  const game = emptyGame();
  game.headers.push(
    { text: "#DIM ADD_CUSTOM_MAX_COM", file: "<button-header>", line: 1 },
    { text: "#DIM ADD_CUSTOM_COM = 381", file: "<button-header>", line: 2 },
    { text: "#DIM C_HEARTPINK = 16751052", file: "<button-header>", line: 3 },
  );
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<attribute-helper>");
  indexScript(game, source.slice(source.indexOf("@Add_Custom_List_COMS\n")), "<custom-button-helpers>");
  indexScript(game, `@SYSTEM_TITLE
ADD_CUSTOM_MAX_COM = 2
CALL Add_Custom_List_COMS
BINPUT
@Add_Custom_COM_To_Number(ARG)
#FUNCTION
RETURNF 9000 + ARG
@Add_Custom_COM_Name(ARG)
#FUNCTIONS
RETURNF "Play a game"
@ADD_CUSTOM_COM_ABLE0
RETURN 1
@ADD_CUSTOM_COM_ABLE1
RETURN 1
@ADD_CUSTOM_COM_ABLE2
RETURN 0
@QOL_CUSTOM_SCOM_CHECK(ARG)
RESULTS = Highlighted action
RETURN ARG == 1`, "<custom-button-fixture>");
  for (const jit of [false, true]) {
    const snapshot = new Runtime(game, undefined, { jit }).start();
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.input?.buttonValues, ["9000", "9001"]);
    const output = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
    assert.match(output, /value='9000' class='era-button [^>]*data-command-number='9000'[^>]*>Play a game<\/button>/);
    assert.match(output, /value='9001' class='era-button [^>]*><span color='#[0-9A-F]{6}'>Highlighted action<\/span>/);
    assert.doesNotMatch(output, /9002|print-cell|era-guard-control/);
  }
});

test("time transitions skip generic narration and waits without suppressing other effects", async () => {
  const patch = readFileSync(new URL("../hotpatch/TIME_EFFECTS.ERB", import.meta.url), "utf8");
  const root = new URL("../GAMES/anon-tw-anon-tw_eng-modding/ERB/", import.meta.url);
  const resumeSource = readFileSync(new URL("時間停止解除.ERB", root), "utf8");
  const resumeAnnouncement = resumeSource.slice(resumeSource.indexOf('SIF !LS_RESTRICTION("Resume time print")'),
    resumeSource.indexOf("追い出し = 0"));
  for (const jit of [false, true]) {
    const game = emptyGame();
    game.names.set("TFLAG", new Map([["TRAIN_MESSAGE_CALLED", 100]]));
    game.names.set("TEQUIP", new Map([["乳首吸い", 1], ["胸揉み", 2], ["BALL_LICKING", 3]]));
    game.names.set("CFLAG", new Map([["うふふ", 1]]));
    indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
MASTER = 0
TARGET = 0
PLAYER = 0
SELECTCOM = 355
CALL COM355
TCVAR:0:22 = 1
CALL TRAIN_MESSAGE
PRINTFORML Frozen: {FLAG:70}, called: {TFLAG:TRAIN_MESSAGE_CALLED}, effects: {FLAG:1}, counters: {FLAG:2}
INPUT
FLAG:70 = 0
${resumeAnnouncement}
PRINTFORML Resumed: {FLAG:70}
INPUT
PRINTFORMW Resume warning remains.
PRINTFORMW Character reaction remains.
TFLAG:TRAIN_MESSAGE_CALLED = 0
SELECTCOM = 300
CALL TRAIN_MESSAGE
PRINTFORML Other restriction: {LS_RESTRICTION("Other", 7, 9)}, args: {FLAG:3}, {FLAG:4}
QUIT
@TRAIN_MESSAGE
@COM355
FLAG:70 = 1
SETBGCOLOR 0x123456
RETURN 1
@MESSAGE_COM355
PRINTL Freeze narration must not appear.
@MESSAGE_COM300
PRINTL Ordinary command message.
@DATUI_BOTTOM_LATE(ARG, ARG:1)
FLAG:1 += 1
@カウンター呼び出し処理
FLAG:2 += 1
@SET_KOJO_COLOR
@LS_RESTRICTION(ARGS, ARG:0, ARG:1)
#FUNCTION
FLAG:3 = ARG:0
FLAG:4 = ARG:1
RETURNF 42`, "<time-transition-test>");
    await withPatchDir({ "TIME_EFFECTS.ERB": patch }, async (dir) => {
      assert.deepEqual(await applyHotpatches(game, dir), ["COM355", "TRAIN_MESSAGE", "LS_RESTRICTION"]);
    });
    const runtime = new Runtime(game, undefined, { jit });
    const frozen = runtime.start();
    assert.equal(frozen.error, null, JSON.stringify(frozen.error));
    assert.equal(frozen.input?.kind, "integer", "freeze returns directly to gameplay input");
    assert.deepEqual(frozen.output.filter((item) => item.type === "text").map((item) => item.text),
      ["Frozen: 1, called: 1, effects: 1, counters: 1"]);
    assert.ok(frozen.output.every((item) => !("style" in item) || item.style.background === "#000000"));
    const resumed = runtime.input("0");
    assert.equal(resumed.error, null, JSON.stringify(resumed.error));
    assert.equal(resumed.input?.kind, "integer", "resume returns directly to gameplay input");
    assert.deepEqual(resumed.output.filter((item) => item.type === "text").map((item) => item.text), ["Resumed: 0"]);
    const warning = runtime.input("0");
    assert.equal(warning.input?.kind, "wait");
    assert.ok(warning.output.some((item) => item.type === "text" && item.text === "Resume warning remains."));
    const reaction = runtime.input("");
    assert.equal(reaction.input?.kind, "wait");
    assert.ok(reaction.output.some((item) => item.type === "text" && item.text === "Character reaction remains."));
    const other = runtime.input("");
    assert.equal(other.error, null, JSON.stringify(other.error));
    assert.equal(other.input?.kind, "wait", "ordinary command PRINTW remains");
    assert.ok(other.output.some((item) => item.type === "text" && item.text === "Ordinary command message."));
    const finished = runtime.input("");
    assert.equal(finished.error, null, JSON.stringify(finished.error));
    assert.equal(finished.status, "halted");
    assert.ok(finished.output.some((item) => item.type === "text" && item.text === "Other restriction: 42, args: 7, 9"));
  }
});

test("hotpatches replace game routines and may add HOTPATCH_ helpers", async () => {
  const game = emptyGame("<memory>");
  indexScript(game, "@SYSTEM_TITLE\nCALL SHOW\nQUIT\n@SHOW\nPRINTL original", "GAME.ERB");
  await withPatchDir({ "A.ERB": "@SHOW\nCALL HOTPATCH_HELPER\n@HOTPATCH_HELPER\nPRINTL patched" }, async (dir) => {
    assert.deepEqual(await applyHotpatches(game, dir), ["SHOW"]);
    assert.equal(game.routines.get("HOTPATCH_ORIGINAL_SHOW")![0]!.lines[0]!.text, "PRINTL original");
    const original = game.routines.get("HOTPATCH_ORIGINAL_SHOW");
    await applyHotpatches(game, dir);
    assert.equal(game.routines.get("HOTPATCH_ORIGINAL_SHOW"), original);
  });
  const output = new Runtime(game).start().output.map((item) => ("text" in item ? item.text : "")).join("");
  assert.equal(output, "patched");
});

test("gazing at the sky wraps the original narration without changing its waits or side effects", async () => {
  const patch = readFileSync(new URL("../hotpatch/GAZE_SKY.ERB", import.meta.url), "utf8");
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
    SELECTCOM = 495
    CALL MESSAGE_COM495
    CALL SOURCE_CHECK
    PRINTW
    PRINTFORML Weather effect: {FLAG:1}, diary choice: {FLAG:2}
    INPUT
    QUIT
@MESSAGE_COM495
PRINTW First weather line
FLAG:1 += 1
PRINTW Second weather line
PRINTBUTTON "Yes", 0
PRINTBUTTON "No", 1
BINPUT
FLAG:2 = RESULT
@SOURCE_CHECK
PRINTL +1 minute
DRAWLINE
@HOTPATCH_SKY
HTML_PRINT "<div class='era-sky era-area-0' data-minutes='360'></div>"`, "<sky-test>");
    await withPatchDir({ "GAZE_SKY.ERB": patch }, async (dir) => {
      assert.deepEqual((await applyHotpatches(game, dir)).sort(), ["MESSAGE_COM495", "SOURCE_CHECK"]);
    });
    const runtime = new Runtime(game, undefined, { jit });
    const first = runtime.start();
    assert.equal(first.error, null, JSON.stringify(first.error));
    assert.equal(first.input?.kind, "wait");
    const output = first.output.map(item => "text" in item ? item.text : "").join("\n");
    assert.match(output, /era-dialog era-sky-dialog/);
    assert.match(output, /era-main-header/);
    assert.match(output, /era-sky era-area-0/);
    assert.doesNotMatch(output, /era-main-when|era-watch-control|era-clock|era-calendar/);
    assert.match(output, /First weather line/);
    const second = runtime.input("");
    assert.equal(second.error, null, JSON.stringify(second.error));
    assert.equal(second.input?.kind, "wait");
    assert.ok(second.output.some(item => item.type === "text" && item.text === "Second weather line"));
    const choice = runtime.input("");
    assert.equal(choice.error, null, JSON.stringify(choice.error));
    assert.equal(choice.input?.kind, "integer", "the original diary choice remains interactive");
    const finished = runtime.input("1");
    assert.equal(finished.error, null, JSON.stringify(finished.error));
    assert.equal(finished.input?.kind, "wait");
    const resultText = finished.output.map(item => "text" in item ? item.text : "").join("\n");
    assert.match(resultText, /\+1 minute[\s\S]*-{10,}[\s\S]*<era-close>[\s\S]*<era-close>/);
    assert.equal(finished.output.filter(item => item.type === "html" && item.text === "<era-close>").length, 2);
    const after = runtime.input("");
    assert.equal(after.input?.kind, "integer");
    assert.ok(after.output.some(item => item.type === "text" && item.text === "Weather effect: 1, diary choice: 1"));
  }
});

test("Move map destination rows render their reachability class", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  assert.ok((await applyHotpatches(game)).includes("PRINT_DESTINATION"));
  indexScript(game, [
    "@PROBE_MOVE_MAP",
    "ADDVOIDCHARA",
    "MASTER = 0",
    "CFLAG:MASTER:現在位置 = 53",
    "MAIN_MAP = 0",
    "ENTRANCE = 22",
    "TFLAG:マップ切り替え = 1",
    "CALL MAP_0_1",
    "WAIT",
  ].join("\n"), "<move-map-test>");

  const snapshot = new Runtime(game).start("PROBE_MOVE_MAP");
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  const destinations = snapshot.output
    .filter((item) => item.type === "html" && item.text.includes("era-move-place"));
  assert.ok(destinations.length > 1, "the current map page should emit destination rows");
  assert.ok(destinations.some((item) => item.text.includes("era-move-more")),
    "non-reachable destinations should be available for the More on this map list");
  assert.ok(destinations.every((item) => !item.text.includes("CAN_MOVE(")),
    "the reachability class expression must be evaluated before rendering");
  assert.ok(destinations.every((item) => item.text.includes("era-move-place-name")),
    "room names have a separate element for alphabetical sorting");
  assert.ok(destinations.every((item) => !item.text.includes("value='22'")),
    "the region exit is promoted to the top rather than duplicated in the page list");
});

test("Move sidebar includes numbered current, home and region-exit rows with notes under names", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const stub = emptyGame();
  indexScript(stub, `@DRAW_MAP(ARGS, ARG)
HTML_PRINT "<era-open class='era-map-art'>"
PRINTL Map fixture
HTML_PRINT "<era-close>"
@LS_MOVE_PRINT`, "<move-map-stubs>");
  for (const name of ["DRAW_MAP", "LS_MOVE_PRINT"]) game.routines.set(name, stub.routines.get(name)!);
  indexScript(game, `@PROBE_MOVE_SIDEBAR
ADDVOIDCHARA
MASTER = 0
CFLAG:MASTER:現在位置 = 9
CFLAG:MASTER:初期位置 = 53
MAIN_MAP = 0
MAXROOM = 57
ENTRANCE = 22
MAP_PAGES = 4
TFLAG:マップ切り替え = 1
CALL HOTPATCH_MOVE_SCREEN(0, 100)
WAIT`, "<move-sidebar-test>");
  const snapshot = new Runtime(game).start("PROBE_MOVE_SIDEBAR");
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  const html = snapshot.output.filter((item) => item.type === "html").map((item) => item.text).join("");
  const client = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
  const marker = runInNewContext(`${client.match(/^const boxMarker = .+;$/m)![0]}\nboxMarker`) as RegExp;
  const boxes: string[] = [];
  for (const item of snapshot.output.filter((item) => item.type === "html")) {
    if (!item.text.startsWith("<era-")) continue;
    const match = marker.exec(item.text);
    assert.ok(match, `the client must recognize every layout marker: ${item.text}`);
    if (match[1] === "open") {
      const classes = match[2]!.match(/class='([^']*)'/)![1]!;
      if (classes.includes("era-move-key")) assert.equal(boxes.at(-1), "era-card era-move-map");
      if (classes.includes("era-map-art")) assert.equal(boxes.at(-1), "era-card era-move-map");
      if (classes.includes("era-move-side")) assert.equal(boxes.at(-1), "era-move-body");
      boxes.push(classes);
    } else {
      assert.ok(boxes.length, "a closing marker must have a matching open box");
      boxes.pop();
    }
  }
  assert.deepEqual(boxes, [], "layout boxes must be balanced");
  assert.match(html, /class='era-move-current' data-room='9'/);
  assert.match(html, /value='0' class='era-move-place era-move-return' data-room='53'/);
  assert.match(html, /value='22' class='era-move-place era-move-exit' data-room='22'/);
  assert.equal((html.match(/value='22'/g) ?? []).length, 1);
  for (const note of ["You are here", "Return to your room", "The way out to other regions"])
    assert.match(html, new RegExp(`class='era-move-place-name'>[^<]+<span class='era-move-place-note'>${note}</span></span>`));
  assert.ok(html.indexOf("era-move-key") < html.indexOf("era-move-side"));
  assert.match(html, /era-move-key-item.*Asleep/);
  assert.match(html, /<font color='#0078B4'>●<\/font> Asleep/);
  assert.doesNotMatch(html, /Room colors:|style='color:/);
  for (const mode of [1, 2]) {
    indexScript(game, `@PROBE_MOVE_KEY_${mode}
ADDVOIDCHARA
MASTER = 0
CFLAG:MASTER:現在位置 = 9
MAIN_MAP = 0
ENTRANCE = 22
MAP_PAGES = 4
TFLAG:マップ切り替え = 1
TALENT:MASTER:汚部屋察知 = 1
FLAG:察知モード = ${mode}
CALL HOTPATCH_MOVE_SCREEN(0, 100)
WAIT`, "<move-legend-test>");
    const output = new Runtime(game).start(`PROBE_MOVE_KEY_${mode}`);
    assert.equal(output.error, null, JSON.stringify(output.error));
    const markup = output.output.filter((item) => item.type === "html").map((item) => item.text).join("");
    assert.match(markup, new RegExp(`era-move-key-item.*${mode === 1 ? "Asleep" : "Garbage Mountain"}`));
    if (mode === 2) assert.doesNotMatch(markup, /era-move-key-item.*Asleep/);
  }
});

test("main and wake-up clock hotpatches pass their exact time in one logical line", () => {
  for (const jit of [false, true]) {
    for (const [file, minutes, title] of [
      ["MAIN_SCREEN.ERB", 367, ""], ["SLEEP_MENU.ERB", 1439, " title='Waking time'"],
    ] as const) {
      const patch = readFileSync(new URL(`../hotpatch/${file}`, import.meta.url), "utf8");
      const instruction = patch.split("\n").find((line) => line.includes("class='era-clock'"))!;
      const game = emptyGame();
      indexScript(game, `@SYSTEM_TITLE
TIME = 367
TIME:3 = 1439
${instruction}
PRINTFORML Lines: {LINECOUNT}, times: {TIME}, {TIME:3}
QUIT`, "<clock-test>");
      const snapshot = new Runtime(game, undefined, { jit }).start();
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      const markup = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []);
      assert.deepEqual(markup, [`<div class='era-clock' data-minutes='${minutes}'${title}></div>`]);
      assert.ok(snapshot.output.some((item) => item.type === "text" && item.text === "Lines: 1, times: 367, 1439"));
    }
  }
});

test("sky hotpatch passes exact game minutes without changing time or weather classes", () => {
  const patch = readFileSync(new URL("../hotpatch/MAIN_SCREEN.ERB", import.meta.url), "utf8");
  const routine = patch.slice(patch.indexOf("@HOTPATCH_SKY\n"), patch.indexOf("@HOTPATCH_SITUATION\n"));
  for (const jit of [false, true]) {
    for (const area of [0, 9])
    for (const [minutes, phase] of [[240, "dawn"], [367, "morning"], [720, "day"], [1080, "evening"], [1439, "night"], [1807, "morning"]] as const) {
      const game = emptyGame();
      game.names.set("FLAG", new Map([["異常気象", 1]]));
      game.names.set("CFLAG", new Map([["現在位置", 1]]));
      indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
MASTER = 0
TIME = ${minutes}
TIME:5 = 7
DAY:2 = 1
DAY:3 = 15
CALL HOTPATCH_SKY
PRINTFORML Time: {TIME}
QUIT
${routine}
@HOTPATCH_AREA
#FUNCTION
RETURNF ${area}`, "<sky-test>");
      const snapshot = new Runtime(game, undefined, { jit }).start();
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      const markup = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []);
      assert.equal(markup.length, 1);
      assert.match(markup[0]!, new RegExp(`class='era-sky era-sky-${phase} era-weather-fog era-season-spring era-area-${area}' data-minutes='${minutes}'`));
      assert.match(markup[0]!, /data-season='1' data-day='15'/);
      assert.ok(snapshot.output.some((item) => item.type === "text" && item.text === `Time: ${minutes}`));
    }
  }
});

test("hotpatches reject new routines that are not named HOTPATCH_*", async () => {
  const game = emptyGame("<memory>");
  indexScript(game, "@SYSTEM_TITLE\nQUIT", "GAME.ERB");
  await withPatchDir({ "A.ERB": "@TYPO_NAME\nPRINTL x" }, async (dir) => {
    await assert.rejects(applyHotpatches(game, dir), /does not define/);
  });
});

test("Wake Up clears the screen before delegating, but other shop commands do not", async () => {
  const patch = readFileSync(new URL("../hotpatch/SLEEP_MENU.ERB", import.meta.url), "utf8");
  for (const jit of [false, true]) {
    for (const command of [100, 2400]) {
      const game = emptyGame("<memory>");
      indexScript(game, `@SYSTEM_TITLE
HTML_PRINT "<div class='era-shop'>Wake Up</div>"
RESULT = ${command}
CALL USERSHOP
PRINTFORML Returned: {RESULT}
QUIT
@SHOW_SHOP
WAIT
@USERSHOP
PRINTFORML Original command: {RESULT}, lines: {LINECOUNT}
RETURN 7`, "<shop-test>");
      await withPatchDir({ "SLEEP_MENU.ERB": patch }, async (dir) => {
        await applyHotpatches(game, dir);
      });
      const snapshot = new Runtime(game, undefined, { jit }).start();
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      const clear = snapshot.output.findIndex((item) => item.type === "clear");
      const original = snapshot.output.findIndex((item) => item.type === "text" && item.text.startsWith("Original command:"));
      assert.equal(clear >= 0, command === 100);
      if (command === 100) {
        assert.ok(clear < original, "clear precedes all original wake-up output");
        assert.deepEqual(snapshot.output[clear], { type: "clear", count: 1 });
      }
      assert.ok(snapshot.output.some((item) => item.type === "text"
        && item.text === `Original command: ${command}, lines: ${command === 100 ? 0 : 1}`));
      assert.ok(snapshot.output.some((item) => item.type === "text" && item.text === "Returned: 7"));
    }
  }
});

test("eraTW native load reaches Wake Up without a confirmation pause and clears it on waking", {
  skip: !existsSync(path.join(GAME_ROOT, "sav", "save00.sav"))
    || !existsSync(path.join(GAME_ROOT, "sav", "global.sav")),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const roomInstructions = (name: string) => game.routines.get(name)![0]!.lines
    .map((line) => line.text.replace(/;.*$/, "").trim()).filter(Boolean);
  assert.deepEqual(roomInstructions("ROOMSETTING"),
    roomInstructions("HOTPATCH_ORIGINAL_ROOMSETTING").map((line) =>
      line === "PRINTFORMW %GET_MAPNAME(MAIN_MAP)%'s room info has been set."
        ? line.replace("PRINTFORMW", "PRINTFORML") : line),
    "room initialization preserves every original instruction except the success wait");
  const save = readFileSync(path.join(GAME_ROOT, "sav", "save00.sav"));
  const global = readNativeSave(readFileSync(path.join(GAME_ROOT, "sav", "global.sav")));
  const stub = emptyGame(game.root);
  indexScript(stub, `@EVENTTRAIN
PRINTL Starting the day
WAIT
@HOTPATCH_TEST_ROOM_FAILURE
MAIN_MAP = 999
デフォルト初期位置 = 1
CALL ROOMSETTING
QUIT`, "<wake-test>");
  for (const [name, routines] of stub.routines) game.routines.set(name, routines);
  for (const jit of [false, true]) {
    const saves = new MemorySaveStore();
    saves.write("save00.sav", save);
    const store = new MemoryGlobalStore();
    store.save(global.data.variables);
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { saves, store, jit });
    assert.equal(runtime.start().error, null);
    assert.equal(runtime.input("1").input?.kind, "integer");
    const loaded = runtime.input("0");
    assert.equal(loaded.error, null, JSON.stringify(loaded.error));
    assert.equal(loaded.input?.kind, "integer", "no intermediate WAIT after choosing a save");
    assert.ok(loaded.output.some((item) => item.type === "html" && item.text.includes("era-wake-button")));
    const awake = runtime.input("100");
    assert.equal(awake.error, null, JSON.stringify(awake.error));
    const clear = awake.output.findIndex((item) => item.type === "clear");
    const day = awake.output.findIndex((item) => item.type === "text" && item.text === "Starting the day");
    assert.ok(clear >= 0 && clear < day, "the sleep screen is cleared before EVENTTRAIN");
    assert.ok(!awake.output.some((item) => item.type === "html" && item.text.includes("era-shop")));
    assert.deepEqual(saves.read("save00.sav"), save, "loading and waking do not modify the native save");

    const failed = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit }).start("HOTPATCH_TEST_ROOM_FAILURE");
    assert.equal(failed.error, null, JSON.stringify(failed.error));
    assert.equal(failed.input?.kind, "wait", "failed room setup still requires acknowledgement");
    assert.ok(failed.output.some((item) => item.type === "text" && item.text === "Failed to set room info."));
  }
});

test("translated ability HTML emits valid six-digit CSS colors", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  const stub = emptyGame(game.root);
  indexScript(stub, `@SYSTEM_TITLE
#DIMS MARKUP
MARKUP '= COLOR_PRINT_HTML("Ex", "C_P_PURPLE", 2)
HTML_PRINT MARKUP
MARKUP '= COLOR_STAMP_HTML(2, 3, "★", "0xFFFF00")
HTML_PRINT MARKUP
WAIT`, "<stub>");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
  assert.equal(snapshot.error, null);
  const markup = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
  assert.match(markup, /<font color='#C070C0'>Ex<\/font>/);
  assert.match(markup, /<font color='#FFFF00'>  ★★<\/font>/);
  assert.doesNotMatch(markup, /#0x/i);
});

test("Palam hotpatch prints one HTML line with formatted values", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  assert.ok((await applyHotpatches(game)).includes("SHOW_INFO_PALAM"));
  const stub = emptyGame(game.root);
  indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
TARGET = 1
PALAM:1:0 = 1234
PALAM:1:11 = 23456
EX:1:20 = 1
PRINTFORML {LINECOUNT}
CALL SHOW_INFO_PALAM
PRINTFORML {LINECOUNT}
WAIT`, "<stub>");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 180 }).start();
  assert.equal(snapshot.error, null);
  const texts = snapshot.output.flatMap((item) => ("text" in item ? [item.text] : []));
  const html = snapshot.output.filter((item) => item.type === "html");
  assert.equal(html.length, 1);
  const markup = "text" in html[0]! ? html[0].text : "";
  assert.match(markup, /^<div class='era-section era-palam'>/);
  assert.match(markup, /era-palam-item era-hot'[^>]*>.*?1234</);
  assert.match(markup, /23\.4k/);
  assert.match(markup, /1234<span class='era-palam-next'>\/\d/, "values show the next level's threshold");
  assert.match(markup, /Next level at \d+/);
  assert.equal(Number(texts.at(-1)) - Number(texts[0]), 2, "the Palam block is one logical line");
});

test("occupants show a non-interactive cage entry at Miracle Mallet's remote-access locations", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const scenarios: {
    name: string;
    room: number;
    setup?: string;
    caged: boolean;
    able: boolean;
    normal?: boolean;
  }[] = [
    { name: "living room", room: 9, caged: true, able: true },
    { name: "veranda", room: 10, caged: true, able: true },
    { name: "other room", room: 8, caged: false, able: false },
    { name: "away living room", room: 8009, caged: false, able: false },
    { name: "away veranda", room: 8010, caged: false, able: false },
    { name: "not at home", room: 9, setup: "MAIN_MAP = 1", caged: false, able: false },
    { name: "cage empty", room: 9, setup: "CFLAG:71:現在位置 = 11", caged: false, able: false },
    { name: "asleep", room: 9, setup: "CFLAG:71:睡眠 = 1", caged: true, able: false },
    { name: "cooldown", room: 10, setup: "CFLAG:MASTER:魔力回収 = 3", caged: true, able: false },
    { name: "time stopped", room: 9, setup: "FLAG:70 = 1", caged: true, able: false },
    { name: "playing Shinmyoumaru", room: 9, setup: "FLAG:なりきり = 71", caged: false, able: true },
    { name: "physically present", room: 9, setup: "CFLAG:71:現在位置 = 9\nTARGET = 71\nTARGET:1 = 71", caged: false, able: true, normal: true },
    { name: "accompanying", room: 9, setup: "TARGET = 71\nTARGET:1 = 71\nCFLAG:71:同行 = 1", caged: false, able: true, normal: true },
    { name: "carried", room: 10, setup: "TARGET = 1\nTARGET:1 = 1\nTFLAG:運搬 = 71", caged: false, able: true, normal: true },
    { name: "with another occupant", room: 9, setup: "TARGET = 1\nTARGET:1 = 1\nCFLAG:1:現在位置 = 9", caged: true, able: true },
  ];
  for (const scenario of scenarios) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
FOR LOCAL, 0, 72
  ADDCHARA LOCAL
NEXT
MASTER = 0
TARGET = 0
MAIN_MAP = 0
MAXROOM = 57
TFLAG:100 = 1
CFLAG:MASTER:現在位置 = ${scenario.room}
CFLAG:71:現在位置 = 54
CALLNAME:71 = Shinmyoumaru
${scenario.setup ?? ""}
FLAG:画像表示 = 3
FLAG:画像表示設定 = 1
isModifier = 10
CALL HOTPATCH_OCCUPANTS
PRINTFORML Image settings: {FLAG:画像表示}, {FLAG:画像表示設定}, {isModifier}
CALL COM_ABLE428
PRINTFORML Mallet available: {RESULT}
WAIT`, "<cage-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, `${scenario.name}: ${JSON.stringify(snapshot.error)}`);
    const markup = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    const text = snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("");
    assert.equal(markup.includes("era-occupant-caged"), scenario.caged, scenario.name);
    assert.match(text, /Image settings: 3, 1, 10/, "rendering each portrait restores the image settings");
    assert.match(text, new RegExp(`Mallet available: ${Number(scenario.able)}`), scenario.name);
    if (scenario.caged) {
      assert.match(markup, /<span class='era-occupant era-occupant-caged(?: era-asleep)?'>/);
      assert.match(markup, /In her cage · Miracle Mallet only/);
      assert.doesNotMatch(markup, /<button[^>]*era-occupant-caged|value='1071'|Nobody else is here/);
      assert.equal((markup.match(/era-occupant-name'>Shinmyoumaru</g) ?? []).length, 1, scenario.name);
      if (scenario.name === "asleep") {
        assert.match(markup, /Miracle Mallet only · Asleep/);
        assert.match(markup, /era-occupant-caged era-asleep/);
        assert.match(markup, /<img[^>]*height='100px'/);
      }
    }
    if (scenario.normal) {
      assert.equal((markup.match(/era-occupant-name'>Shinmyoumaru</g) ?? []).length, 1, scenario.name);
      if (scenario.name !== "carried") assert.match(markup, /value='1071'/);
    }
  }
});

test("main screen hotpatch opens and closes its panel boxes in balance", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  const patched = await applyHotpatches(game);
  assert.ok(patched.includes("SHOW_STATUS") && patched.includes("SHOW_USERCOM"));
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { columns: 149 });
  let snapshot = runtime.start();
  let markup: string[] = [];
  const step = (value: string) => {
    markup = [];
    snapshot = runtime.input(value);
    if (value === "355" || value === "999" || value === "490" || value === "9999") {
      assert.notEqual(snapshot.input?.kind, "wait", `${value} has no generic transition pause: ${
        snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join("\n")}`);
      assert.ok(!snapshot.output.some((item) => item.type === "text" &&
        (item.text === "You let time resume." || /ＷＡＲＵＤＯ|ＳＴＯＰ・ＴＩＭＥ/.test(item.text))),
      `${value} uses animation instead of generic narration`);
    }
    for (let guard = 0; ; guard++) {
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      for (const item of snapshot.output) if (item.type === "html") markup.push(item.text);
      if (snapshot.input?.kind !== "wait" || guard > 500) break;
      snapshot = snapshot.input.timeout ? runtime.timeout() : runtime.input("");
    }
  };
  // Accept the default character, then the first main screen, Time Stop and Resume Time.
  for (const value of ["0", "100"]) step(value);
  const screens: string[][] = [];
  for (const value of ["100", "355", "999"]) {
    step(value);
    assert.ok(!snapshot.output.some((item) => item.type === "text" && /<Last (Training )?Command:/.test(item.text)),
      "last-command hint does not occupy a terminal line");
    if (value === "355") assert.equal(snapshot.lastCommand, "Last Command: Time Stop");
    if (value === "355") {
      assert.ok(!snapshot.output.some((item) => item.type === "text" && /^-{3,}$/.test(item.text)),
        "freeze has no legacy dashed separator");
      assert.ok(snapshot.output.every((item) => !("style" in item) || item.style.background === "#000000"),
        `freeze uses GUI frost rather than a flat blue output background: ${
          [...new Set(snapshot.output.flatMap((item) => "style" in item ? [item.style.background] : []))].join(",")}`);
    }
    screens.push(markup);
  }
  for (const [index, screen] of screens.entries()) {
    const opens = screen.filter((text) => text.startsWith("<era-open")).length;
    const closes = screen.filter((text) => text === "<era-close>").length;
    assert.ok(opens > 5, `screen ${index} draws the panels`);
    assert.equal(opens, closes, `screen ${index} closes every box`);
    assert.ok(screen.some((text) => text.includes("era-timestop-button")), `screen ${index} has the time stop control`);
    const html = screen.join("");
    if (index === 0) {
      assert.match(html, /value='995' class='era-toggle[^']*' role='checkbox' aria-checked='(?:true|false)'[^>]*>Auto-TSP Movement<\/button>/);
      assert.match(html, /value='996' class='era-toggle[^']*' role='checkbox' aria-checked='(?:true|false)'[^>]*>Auto-Clean<\/button>/);
    }
    assert.match(html, /<div class='era-clock' data-minutes='\d+'><\/div>/);
    assert.match(html, /<era-open class='era-watch-control'>.*class='era-clock'.*era-timestop-button/);
    const whenStart = screen.indexOf("<era-open class='era-main-when'>");
    const whenEnd = screen.indexOf("<era-close>", whenStart);
    const when = screen.slice(whenStart + 1, whenEnd);
    assert.ok(when.every(text => text.trim()), "date panel has no blank HTML lines");
    assert.equal((html.match(/value='993'/g) ?? []).length, 1, "calendar has exactly one entry point");
    assert.ok(when.some(text => /value='993' class='era-chip-button era-calendar-button'/.test(text)),
      "calendar is an icon button in the date panel");
    assert.doesNotMatch(html.slice(html.indexOf("era-actions-panel")), /value='993'|Calendar\[993\]/,
      "calendar is not a player management control");
    if (index === 1) {
      assert.match(html, /value='999' class='era-timestop-button era-stopped' title='Resume time'>Resume<span class='era-timestop-gauge'>/);
      assert.doesNotMatch(html, /Time is stopped/);
    }
    assert.doesNotMatch(html, /<div class='era-clock'><img/);
    assert.equal((html.match(/value='805'/g) ?? []).length, 1, "inventory has exactly one entry point");
    assert.match(html, /era-player-actions'><button value='805' class='era-button era-button-block /, "inventory is on the player card");
    assert.match(html, /data-command-number='805' data-suffix='›'/, "inventory supplies its shortcut and suffix as metadata");
    assert.match(html, /value='490'/, "the game's Items command remains available alongside the GUI inventory");
    assert.match(html, /class='era-toggles era-auto-toggles'><button value='995'[^]*<button value='-9200' class='era-toggle[^']*' role='checkbox' aria-checked='(?:true|false)'[^>]*>Pushdown Guard<\/button><\/div>/, "the guard shares the compact checkbox row with Auto-TSP and Auto-Clean");
    assert.doesNotMatch(html, /era-player-toggles|Go &amp; Manage|Auto Items/);
  }
  assert.ok(screens[1]!.some((text) => /era-stopped'[^>]*value='999'|value='999'[^>]*era-stopped/.test(text)), "time stop switches to Resume Time");
  step("805");
  assert.ok(markup.some((text) => text.includes("era-dialog era-inventory")), "805 opens the inventory from the main screen");
  step("999");
  assert.ok(markup.some((text) => text.includes("era-player-actions")), "closing inventory returns to the player panel");
  step("490");
  assert.equal(snapshot.input?.kind, "integer", "Items opens directly at item selection without a Continue wait");
  assert.ok(!snapshot.output.some(item => item.type === "text" && item.text === "Pick an item to use."));
  assert.ok(markup.some((text) => text.includes("era-dialog era-inventory era-item-use")), "490 opens the shared item picker");
  step("9999");
  assert.equal(snapshot.input?.kind, "integer", "cancelling Items returns directly to command input");
  assert.ok(markup.some((text) => text.includes("era-player-actions")), "closing Items returns to the player panel");
  step("993");
  assert.ok(markup.some(text => text.includes("era-dialog era-calendar")),
    "993 opens the calendar from the main screen");
  step("0");
  assert.ok(markup.some(text => text.includes("era-player-actions")), "closing calendar returns to the player panel");
});

test("calendar popup preserves dates and work fields across views, details and season rollover", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const jit of [false, true]) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
DAY = 124
DAY:2 = 4
DAY:3 = 31
TIME = 720
FLAG:1007 = 1
CFLAG:1:信頼度 = 100
MAXBASE:1:仕事量 = 321
TCVAR:1:仕事開始 = 123
TCVAR:1:仕事終了 = 456
CFLAG:1:職場 = 9
CFLAG:1:職種 = 2
TCVAR:1:給料 = 789
TCVAR:1:お礼 = 12
CALL CALENDAR
PRINTFORML State: {DAY}, {DAY:2}, {DAY:3}, {TIME}
PRINTFORML Work: {MAXBASE:1:仕事量}, {TCVAR:1:仕事開始}, {TCVAR:1:仕事終了}, {CFLAG:1:職場}, {CFLAG:1:職種}, {TCVAR:1:給料}, {TCVAR:1:お礼}
QUIT
@CHARA_HOLIDAY(ARG, ARG:1)
#FUNCTION
RETURNF 0`, "<calendar-popup-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    game.routines.set("CHARA_HOLIDAY", stub.routines.get("CHARA_HOLIDAY")!);
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
    let snapshot = runtime.start();
    const check = (cards: number) => {
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      assert.equal(snapshot.input?.kind, "integer");
      const html = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
      assert.match(html, /era-dialog era-calendar/);
      assert.equal((html.match(/<era-open class='era-calendar-day(?:'| )/g) ?? []).length, cards);
      const opens = snapshot.output.filter(item => item.type === "html" && item.text.startsWith("<era-open")).length;
      const closes = snapshot.output.filter(item => item.type === "html" && item.text === "<era-close>").length;
      assert.equal(opens, closes);
      assert.doesNotMatch(html, /┌|├|│/);
      return html;
    };
    const initial = check(7);
    assert.equal((initial.match(/class='era-calendar-month-date/g) ?? []).length, 31);
    assert.equal((initial.match(/class='era-calendar-month-blank'/g) ?? []).length, 4,
      "Winter starts on Wednesday and needs five calendar rows");
    assert.match(initial, /value='-9531' class='[^']*era-calendar-selected[^']*era-calendar-month-today/);
    assert.match(initial, /era-calendar-number'>31</);
    assert.match(initial, /era-calendar-number'>1</);
    for (const [value, firstDate, year] of [
      ["-9402", 1, 2], ["-9503", 3, 2], ["-9401", 1, 1], ["-9531", 31, 1],
      ["-9403", 31, 1],
    ] as const) {
      snapshot = runtime.input(value);
      const html = check(7);
      assert.equal((html.match(/class='era-calendar-month-date/g) ?? []).length, 31);
      assert.match(html, new RegExp(`era-calendar-number'>${firstDate}<`));
      assert.match(html, new RegExp(`Year ${year}</span>`));
      if (value === "-9402") {
        assert.equal((html.match(/class='era-calendar-month-blank'/g) ?? []).length, 11,
          "the next year's Spring starts on Saturday and needs six calendar rows");
        assert.match(html, /class='era-calendar-date' title='1st of Spring, Year 2'/);
      }
    }
    // Navigate back to the first season, then verify its lower bound.
    for (let season = 0; season < 3; season++) {
      snapshot = runtime.input("-9401");
      check(7);
    }
    snapshot = runtime.input("-9401");
    assert.match(check(7), /This is the first season/);
    snapshot = runtime.input("-9403");
    check(7);
    for (const value of ["901", "900", "1", "-1"]) {
      assert.ok(snapshot.input?.buttonValues?.includes(value), `${value}: ${snapshot.input?.buttonValues}`);
      snapshot = runtime.input(value);
      const html = check(value === "1" ? 0 : 7);
      if (value === "1") {
        assert.match(html, /era-calendar-detail/);
        assert.match(html, /class='era-info-face'/);
        assert.match(html, /<img src='[^']+' height='74px'>/, "details reuse the selected character's head artwork");
      }
    }
    assert.ok(snapshot.input?.buttonValues?.includes("0"));
    assert.throws(() => runtime.input("9999"), /displayed button/);
    snapshot = runtime.input("0");
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.equal(snapshot.status, "halted");
    assert.deepEqual(snapshot.output.flatMap(item => item.type === "text" ? [item.text] : []),
      ["State: 124, 4, 31, 720", "Work: 321, 123, 456, 9, 2, 789, 12"]);
  }
});

test("calendar marks upcoming landlord tribute and pending collection without changing obligations", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const jit of [false, true]) {
    for (const [today, landlord, pending, selected, due, notice] of [
      [31, 1, 0, 31, true, false],
      [124, 1, 0, 124, true, false],
      [32, 1, 0, 32, false, false],
      [34, 1, 1, 34, false, true],
      [34, 1, 1, 1, false, true],
      [31, 0, 1, 31, false, false],
    ] as const) {
      const stub = emptyGame(game.root);
      indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
CALLNAME:1 = Landlord
DAY = ${today}
DAY:2 = ${Math.floor((today - 1) / 31) % 4 + 1}
DAY:3 = ${(today - 1) % 31 + 1}
FLAG:地主 = ${landlord}
FLAG:年貢 = ${pending}
FLAG:畑仕事の成果 = 73
FLAG:地主貸付金 = 2500
CALL CALENDAR
PRINTFORML Obligations: {FLAG:地主}, {FLAG:年貢}, {FLAG:畑仕事の成果}, {FLAG:地主貸付金}
PRINTFORML Date: {DAY}, {DAY:2}, {DAY:3}
QUIT`, "<calendar-tribute-test>");
      game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
      const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT, { jit });
      let snapshot = runtime.start();
      if (selected === 1) {
        snapshot = runtime.input("-9401");
      }
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      const html = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
      assert.equal(html.includes("Harvest tribute due - Landlord"), due);
      assert.equal(html.includes("era-calendar-tribute-notice"), notice);
      assert.equal(html.includes("Harvest tribute pending collection - Landlord"), notice);
      if (due) {
        snapshot = runtime.input("-9402");
        assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
        const month = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
        assert.match(month, /value='-9501'[^>]*title='[^']*Harvest tribute due - Landlord[^']*'>.*?era-calendar-tribute-dot/);
      }
      if (!landlord) assert.doesNotMatch(html, /era-calendar-tribute-dot|Harvest tribute/);
      snapshot = runtime.input("0");
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      assert.deepEqual(snapshot.output.flatMap(item => item.type === "text" ? [item.text] : []),
        [`Obligations: ${landlord}, ${pending}, 73, 2500`,
          `Date: ${today}, ${Math.floor((today - 1) / 31) % 4 + 1}, ${(today - 1) % 31 + 1}`]);
    }
  }
});

test("calendar command bypasses the native home-room restriction without changing other commands", () => {
  const patch = readFileSync(new URL("../hotpatch/RELATIONSHIPS.ERB", import.meta.url), "utf8");
  const handler = patch.slice(patch.indexOf("@USERCOM\n"), patch.indexOf("@ASK_YN("));
  for (const jit of [false, true]) {
    for (const room of [0, 9]) {
      const game = emptyGame();
      game.names.set("CFLAG", new Map([["現在位置", 1], ["初期位置", 2]]));
      indexScript(game, `@SYSTEM_TITLE
ADDVOIDCHARA
MASTER = 0
CFLAG:MASTER:現在位置 = ${room}
CFLAG:MASTER:初期位置 = 0
RESULT = 993
CALL USERCOM
PRINTFORML Calendar: {FLAG:1}, result: {RESULT}
RESULT = 805
CALL USERCOM
PRINTFORML Other command: {FLAG:2}
QUIT
${handler}
@HOTPATCH_RELATIONSHIP_CONFIRM(ARG)
@HOTPATCH_CONFESSION_FLOW(ARG)
@カレンダー
FLAG:1 += 1
@HOTPATCH_ORIGINAL_USERCOM
FLAG:2 = RESULT`, "<calendar-command-test>");
      const snapshot = new Runtime(game, undefined, { jit }).start();
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      assert.deepEqual(snapshot.output.flatMap(item => item.type === "text" ? [item.text] : []),
        ["Calendar: 1, result: 0", "Other command: 805"]);
    }
  }
});

test("action filters and command categories share vaginal, anal, SM and service colors", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const [on, previous, custom, repeat] of [[0, -1, -1, null], [1, 300, -1, 300], [1, 412, -1, 412], [1, 381, 0, 9000]]) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
CFLAG:1:うふふ = 1
CFLAG:1:Ｖアンフィルタ = ${on}
CFLAG:1:Ａアンフィルタ = ${on}
CFLAG:1:ＳＭアンフィルタ = ${on}
CFLAG:1:奉仕アンフィルタ = ${on}
CFLAG:1:RevServiceFilter = ${on}
PREVCOM = ${previous}
ADD_PREVCUSTOMCOM = ${custom}
CALL HOTPATCH_FILTERS(63)
PRINTFORML Kinds: %HOTPATCH_ACTION_KIND(3)%,%HOTPATCH_ACTION_KIND(5)%,%HOTPATCH_ACTION_KIND(100)%,%HOTPATCH_ACTION_KIND(81)%
QUIT`, "<filter-colors-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    for (const [id, kind] of [[831, "vaginal"], [832, "anal"], [836, "sm"], [835, "service"], [-9120, "service"]]) {
      assert.match(html, new RegExp(`value='${id}' class='era-toggle era-kind-${kind}${on ? " era-on" : ""}' role='checkbox' aria-checked='${on ? "true" : "false"}'`));
    }
    if (repeat !== null) assert.match(html, new RegExp(`<button value='${repeat}' class='era-repeat' title='Repeat last action' aria-label='Repeat last action'></button></span></div>$`));
    else assert.doesNotMatch(html, /era-repeat|🔁/);
    assert.ok(snapshot.output.some((item) => item.type === "text" && item.text === "Kinds: vaginal,anal,sm,service"));
  }
});

test("player special effects and gauges use compact HTML without changing gauge initialization", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const [phase, mode, change, milk] of [[0, 0, 0, 0], [2, 0, 0, 1], [3, 5, 1, 0], [2, 4, 0, 1]] as const) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
ADDCHARA 2
MASTER = 0
TARGET = 1
ASSI = 2
CFLAG:0:現在位置 = 9
TALENT:0:2 = 2
TALENT:1:2 = 2
TALENT:0:絶倫 = 1
BASE:0:精力 = -5
BASE:1:精力 = -10
BASE:0:射精 = 2500
MAXBASE:0:射精 = 7500
MAXBASE:1:射精 = 0
MAXBASE:2:射精 = 0
TFLAG:102 = ${phase}
TFLAG:EjacChange = ${change}
TCVAR:0:射精我慢 = ${mode}
TCVAR:0:イきそう = ${Number(mode === 4)}
TALENT:1:母乳体質 = ${milk}
TALENT:1:淫乳 = 1
CALL HOTPATCH_PLAYER_SPECIAL
TCVAR:0:祝福 = 1
TCVAR:0:LARGE_LOADS = 2
TFLAG:幸運補正 = -1
FLAG:自室施錠 = 1
TFLAG:仙香玉兎 = 120
TCVAR:0:国士無双の薬 = 2
TFLAG:ポイズンボディ = 120
TFLAG:GG設置位置 = 9
TFLAG:FORTUNE_REVERSED = 120
GatheringSeason = 1
TFLAG:SEASON_STONE_USES_REMAINING = 3
TFLAG:ANYWHERE_DOOR_USES_REMAINING = 4
TCVAR:0:エンチャント = 1
TCVAR:0:加護 = 1
TCVAR:0:豊穣 = 1
TEQUIP:0:SWIMMING = 1
TCVAR:0:LIMITLESS_ACTIVE = 1
TCVAR:0:PURIFICATION_DRUG_ACTIVE = 1
TCVAR:0:SENSITIVITY_NUMBED = 1
TCVAR:0:PERPETUAL_ERECTION = 1
TCVAR:0:INFINITE_VIG = 1
CALL HOTPATCH_PLAYER_SPECIAL
CALL HOTPATCH_PLAYER_GAUGES
PRINTFORML State: {BASE:0:精力},{BASE:1:精力},{MAXBASE:0:射精},{MAXBASE:1:射精},{MAXBASE:2:射精}
QUIT
@IS_WISEMAN
#FUNCTION
RETURNF FLAG:自室施錠`, "<special-test>");
    for (const [name, routines] of stub.routines) game.routines.set(name, routines);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.equal((html.match(/era-player-effects/g) ?? []).length, 1, "empty Special is omitted");
    for (const effect of ["Blessing", "Extreme Loads", "Misfortune", "Door Locked"]) assert.ok(html.includes(effect));
    const special = html.match(/<div class='era-player-status era-player-effects'>(.*?)<\/div>/)?.[1];
    assert.ok(special);
    const effects = [...special.matchAll(/<span class='era-status'[^>]* title='([^']*)'>(.*?)<\/span>/g)];
    assert.equal(effects.length, 21, "every active Special effect is rendered");
    assert.ok(effects.every(([, title]) => title!.length > 10), "every effect has an explanatory tooltip");
    assert.equal(html.includes("era-special-gauges"), phase !== 0);
    if (phase) {
      assert.match(html, /meter value='2500' max='(?:5000|7500)'/);
      assert.match(html, /value='5000' class='era-release-mode/);
      assert.match(html, /value='5001' class='era-release-mode/);
      assert.ok(html.includes(mode === 5 ? "Quick" : mode === 4 ? "Endure 4" : "Normal"));
      assert.equal(html.includes("Imminent"), mode === 4);
      assert.equal(html.includes("era-milk"), milk === 1);
    }
    assert.ok(snapshot.output.some((item) => item.type === "text"
      && item.text === `State: 0,0,${change ? 7500 : 5000},10000,10000`));
  }
});

test("management settings expose guard state and explain character-specific posture and moan options", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const mode of [0, 1, 2]) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
FLAG:70 = 1
FLAG:押し倒し = ${mode % 2}
CFLAG:1:オート喘ぎ = ${mode}
CFLAG:1:STANDING_TOGGLE = ${mode % 2}
CALL HOTPATCH_SETTINGS
QUIT`, "<settings-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.doesNotMatch(html, /Pushdown Guard|Auto Items/, "guard is with management actions; Auto Items is in Inventory");
    assert.match(html, /title='Standing: Prefer standing versions/);
    assert.match(html, /title='Auto-moan: [^']+Cycles this character through No, Yes and Yes \(Ahegao\)/);
    assert.match(html, new RegExp(`value='4000' class='era-toggle' role='checkbox' aria-checked='${["false", "true", "mixed"][mode]}'`));
    assert.match(html, /Automatic Condom/);
    assert.ok(
      html.indexOf("Automatic Condom") < html.indexOf("value='809'")
      && html.indexOf("Auto-moan") < html.indexOf("value='809'")
      && html.indexOf("Standing") < html.indexOf("value='809'"),
      "character-specific checkboxes appear above Config",
    );
  }
});

test("pilfer commands remain usable during frozen-time mischief sessions", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const [command, frozen, session, expected] of [
    [821, 1, 0, true], [821, 1, 1, true], [821, 0, 0, true], [821, 0, 1, false],
    [825, 1, 0, true], [825, 1, 1, true], [825, 0, 0, true], [825, 0, 1, false],
  ] as const) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
TARGET:1 = 1
FLAG:70 = ${frozen}
CFLAG:1:イタズラ = !FLAG:70
CFLAG:1:うふふ = ${session}
CFLAG:1:現在位置 = 9
CFLAG:0:現在位置 = 9
EQUIP:0 = 1
EQUIP:1:下半身下着２ = 1
TFLAG:パンツ収奪 = 1
RESULT = ${command}
CALL USERCOM
PRINTFORML Collected: {EQUIP:1:下半身下着２ == 0}
QUIT
@脱衣処理(C_ID, TYPE, OP)
#DIM C_ID
#DIMS TYPE
#DIMS OP
CALL PANTS_GET(C_ID)
@PANTS_GET(ARG, ARGS)
EQUIP:ARG:下半身下着２ = 0
@GET_INT(ARG, ARGS, ARG:1, ARGS:1)
#FUNCTION
RETURNF 1
@KOJO_CHECK(CHARA, ARGS, ARGS:1, ARG, ARG:1)
#DIM CHARA
RETURN 0
@PANTS_ALREADY_COLLECTED(ARG)
#FUNCTION
RETURNF 1
@PANTSNAME(ARG, ARG:1)
#FUNCTIONS
RETURNF "panties"`, "<pilfer-test>");
    for (const [name, routines] of stub.routines) game.routines.set(name, routines);
    const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
    let snapshot = runtime.start();
    const text: string[] = [];
    for (let guard = 0; ; guard++) {
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      text.push(...snapshot.output.flatMap((item) => "text" in item ? [item.text] : []));
      if (snapshot.input?.kind !== "wait") break;
      assert.ok(guard < 10, "pilfer completes without an input loop");
      snapshot = runtime.input("");
    }
    assert.ok(text.includes(`Collected: ${Number(expected)}`), `${command}, frozen=${frozen}, session=${session}: ${text.join("\n")}`);
  }
});

test("character info and player panels share body-size labels and highlights", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const size of [0, -5, -2, -1, 1, 2, 5]) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
CALL MAKE_TALENT_MAP
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
nameArray:1:na_Title = ●Race:Human
TALENT:MASTER:体型 = ${size}
TALENT:TARGET:体型 = ${size}
HTML_PRINT HOTPATCH_PLAYER_KIND()
CALL HOTPATCH_TARGET_SITUATION
WAIT`, "<info-size-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, `${size}: ${JSON.stringify(snapshot.error)}`);
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    const sizes = [...html.matchAll(/<span class='era-size(?: era-unusual)?'[^>]*>[^<]+<\/span>/g)].map((match) => match[0]);
    assert.equal(sizes.length, 2, "player and target both show body size");
    assert.equal(sizes[0]!.includes("era-unusual"), size !== 0);
    assert.equal(sizes[1]!.includes("era-unusual"), size !== 0);
    assert.match(sizes[0]!, /title='Body size; a mallet can change it'/, "only player size has the mallet tooltip");
    assert.doesNotMatch(sizes[1]!, /title=/, "character info size has no tooltip");
    if (!size) {
      assert.match(sizes[0]!, />Adult</);
      assert.match(sizes[1]!, />Adult</);
    }
    assert.match(html, /class='era-race'[^>]*>[^<]+<\/span><span class='era-sep'> · <\/span>/);
    assert.match(html, /<div class='era-character-kind'><span class='era-race'[^>]*>[^<]+<\/span><span class='era-sep'> · <\/span><span class='era-size(?: era-unusual)?'[^>]*>[^<]+<\/span><\/div>/,
      "race and size share one HTML output row");
  }
});

test("character titles fill quiet info panels without hiding relationship or mood tags", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const scenarios = [
    { name: "quiet", setup: "", blurb: true },
    { name: "missing title", setup: `nameArray:1:na_Title '= ""`, blurb: false },
    { name: "hate mark", setup: "MARK:1:反発刻印 = 2", blurb: false, tag: "Hate Lv2" },
    { name: "relationship", setup: "TALENT:1:恋慕 = 1", blurb: false, tag: "era-feel-love" },
    { name: "happy", setup: "TALENT:1:機嫌 = 1", blurb: false },
    { name: "sullen", setup: "TALENT:1:機嫌 = -1", blurb: false },
    { name: "angry", setup: "BASE:1:怒り = 200", blurb: false },
    { name: "asleep", setup: "CFLAG:1:睡眠 = 1", blurb: false },
  ];
  for (const scenario of scenarios) {
    const stub = emptyGame(game.root);
    indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
ADDCHARA 1
MASTER = 0
TARGET = 1
BASE:1:怒り = 0
CFLAG:1:溜まってる度 = 123
TALENT:MASTER:劣情察知 = 1
nameArray:1:na_Title = ～A <quiet> visitor～　●Race:Human　●Ability:Floating
${scenario.setup}
CALL HOTPATCH_TARGET_SITUATION
WAIT`, "<info-title-test>");
    game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
    const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
    assert.equal(snapshot.error, null, `${scenario.name}: ${JSON.stringify(snapshot.error)}`);
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.match(html, /class='era-fact-label'>Frustration<\/span>12%<\/span>/);
    assert.equal(html.includes("era-character-blurb"), scenario.blurb, scenario.name);
    if (scenario.blurb) assert.match(html, /era-character-blurb'>A &lt;quiet&gt; visitor</);
    if (scenario.tag) assert.ok(html.includes(scenario.tag), "existing tags remain visible");
    if (scenario.name === "relationship")
      assert.match(html, /era-character-heading[^]*value='352'[^]*era-relationship-icon-love[^]*era-character-state/);
    if (scenario.name === "quiet") assert.doesNotMatch(html, /era-relationship-open|era-relationship-icon-none/);
    assert.doesNotMatch(html, /Discuss relationship/);
    assert.doesNotMatch(html, /●Race:|●Ability:/, "redundant race and ability fields are not part of the title");
  }
});

test("alcohol availability excludes empty inventory and non-alcohol drinks", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const stub = emptyGame();
  indexScript(stub, `@SYSTEM_TITLE
VALID_DRINK_COUNT = 2
VALID_DRINKS_LIST:0 = 100
VALID_DRINKS_LIST:1 = 101
ITEM:100 = 3
ITEM:101 = 0
PRINTFORML {HOTPATCH_HAS_ALCOHOL()}
ITEM:101 = 1
PRINTFORML {HOTPATCH_HAS_ALCOHOL()}
ITEM:101 = 0
PRINTFORML {HOTPATCH_HAS_ALCOHOL()}
QUIT
@IS_ALC(ARG)
#FUNCTION
RETURNF ARG == 101`, "alcohol-test.ERB");
  for (const [name, routine] of stub.routines) game.routines.set(name, routine);
  const snapshot = new Runtime(game, GAME_INSTRUCTION_LIMIT).start();
  assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  assert.deepEqual(snapshot.output.filter((item) => item.type === "text").map((item) => item.text), ["0", "1", "0"]);
});

test("room lineup renders every portrait and preserves target selection", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  for (const scenario of ["1", "2", "3", "4", "5", "6", "7", "9", "11"]) {
    const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
    runtime.start();
    runtime.input("8");
    let snapshot = runtime.input(scenario);
    const markup: string[] = [];
    for (let waits = 0; ; waits++) {
      assert.equal(snapshot.error, null, `${scenario}: ${JSON.stringify(snapshot.error)}`);
      for (const item of snapshot.output) if (item.type === "html") markup.push(item.text);
      if (snapshot.input?.kind !== "wait") break;
      assert.ok(waits < 40, "scenario reaches the main screen");
      snapshot = runtime.input("");
    }
    const html = markup.join("");
    assert.ok(!snapshot.output.some((item) => "text" in item && item.text.includes("Change Partner")),
      "the lineup replaces the redundant Change Partner menu button");
    const count = scenario === "11" ? 24 : scenario === "4" ? 6 : ["3", "5"].includes(scenario) ? 2 : ["1", "6", "9"].includes(scenario) ? 0 : 1;
    assert.equal((html.match(/<era-open class='era-portrait'>/g) ?? []).length, count, scenario);
    assert.equal((html.match(/class='era-occupant-label' aria-pressed='true'/g) ?? []).length, count ? 1 : 0, scenario);
    assert.equal((html.match(/<era-open/g) ?? []).length, (html.match(/<era-close>/g) ?? []).length, scenario);
    assert.doesNotMatch(html, /era-main-occupants/, "occupants are inside the room card");
    assert.doesNotMatch(html, /era-selected/, "selection uses only the existing sprite highlight, not an occupant highlight");
    assert.ok(html.indexOf("era-character") < html.indexOf("era-occupant-list"));
    assert.match(html, /era-room-stage/, "the lineup is inside a room stage");
    assert.doesNotMatch(html, /era-interaction-history/, "history is in the bottom chat, not Character Info");
    if (count) assert.ok(snapshot.characterHistory, "main-screen output supplies the bottom chat's history");
    assert.doesNotMatch(html, /era-room-shrine|\/rooms\//, "the room has no illustrated background");
    assert.doesNotMatch(html, />Room Occupants</, "the room itself replaces the occupant-list heading");
    if (!count) {
      assert.equal((html.match(/Nobody else is here/g) ?? []).length, 1, "one empty-room message");
      assert.doesNotMatch(html, /Just you|No one else is in the room/);
      continue;
    }
    const labels = [...html.matchAll(/<button value='(\d+)' class='era-occupant-label' aria-pressed='(true|false)'/g)];
    assert.doesNotMatch(html, /era-info-tabs|era-info-title|Go &amp; Manage/);
    assert.match(html, /value='-9300' class='era-text-button'/, "More opens details for the selected character");
    assert.match(html, /<era-open class='era-info-summary'><button value='-9300'/, "See more is beside the character name");
    assert.match(html, /value='-9200' class='era-toggle' role='checkbox' aria-checked='false'/);
    assert.doesNotMatch(html, /Auto Items/);
    assert.match(html, /<era-open class='era-info-body'>/);
    assert.match(html, /era-info-face/, "the details identify the selected person");
    assert.match(html, /<era-open class='era-info-head'>/);
    assert.match(html, /<era-open class='era-info-summary'>/);
    assert.equal(labels.length, count);
    const originalTarget = snapshot.target;
    assert.equal(originalTarget, Number(labels.find((label) => label[2] === "true")![1]) - 1000);
    if (scenario === "11") {
      assert.equal(new Set(labels.map((label) => label[1])).size, 24, "stress crowd has distinct characters");
      assert.equal(originalTarget, Number(labels.at(-1)![1]) - 1000, "stress crowd starts with the last person selected");
    }
    const next = labels.find((label) => label[2] === "false") ?? labels[0]!;
    snapshot = runtime.input(next[1]!);
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const selected = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.match(selected, new RegExp(`value='${next[1]}' class='era-occupant-label' aria-pressed='true'`));
    assert.equal(snapshot.target, Number(next[1]) - 1000);
    if (count > 1) assert.notEqual(snapshot.target, originalTarget);
  }
});

test("character More opens the selected person's sheet while See more still opens the player", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  await applyHotpatches(game);
  const runtime = new Runtime(demoGame(game), GAME_INSTRUCTION_LIMIT);
  runtime.start();
  runtime.input("8");
  let snapshot = runtime.input("3");
  const settle = () => {
    for (let waits = 0; snapshot.input?.kind === "wait"; waits++) {
      assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
      assert.ok(waits < 40);
      snapshot = runtime.input("");
    }
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
  };
  const html = () => snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
  settle();
  const labels = [...html().matchAll(/value='(\d+)' class='era-occupant-label' aria-pressed='(true|false)'/g)];
  const next = labels.find((label) => label[2] === "false")!;
  snapshot = runtime.input(next[1]!);
  settle();
  const selected = snapshot.target;
  assert.equal(selected, Number(next[1]) - 1000);
  const selectedName = html().match(new RegExp(`value='${next[1]}' class='era-occupant-label'[^>]*>.*?era-occupant-name'[^>]*>([^<]+)<`))![1];
  for (const command of ["803", "-9300"]) {
    snapshot = runtime.input(command);
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.match(html(), /era-dialog era-sheet/);
    assert.match(html(), /value='77' class='era-sheet-step'/);
    assert.match(html(), /value='88' class='era-sheet-step'/);
    assert.match(html(), /era-sheet-caption'>Character sheet<\/span><div class='era-sheet-people'>/);
    assert.doesNotMatch(html(), /era-sheet-name/);
    if (command === "803") assert.match(html(), /value='5000' class='era-sheet-person era-current'/);
    else {
      assert.equal(html().match(/class='era-sheet-person era-current'>([^<]+)</)![1], selectedName);
      assert.doesNotMatch(html(), /value='5000' class='era-sheet-person era-current'/);
      assert.doesNotMatch(html(), /class='era-sheet-person'>[^<]+<span class='era-sub'>You/);
    }
    assert.equal(snapshot.target, selected, "opening a sheet does not change the selected target");
    const initialName = html().match(/class='era-sheet-person era-current'>([^<]+)</)![1];
    snapshot = runtime.input("88");
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.notEqual(html().match(/class='era-sheet-person era-current'>([^<]+)</)![1], initialName);
    snapshot = runtime.input("77");
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    assert.equal(html().match(/class='era-sheet-person era-current'>([^<]+)</)![1], initialName);
    assert.equal(snapshot.target, selected, "sheet navigation does not change the room target");
    snapshot = runtime.input("0");
    settle();
    assert.match(html(), /era-text-button/);
    assert.equal(snapshot.target, selected);
  }
  snapshot = runtime.input("-9200");
  settle();
  const first = html().match(/value='-9200' class='era-toggle(?: era-on)?' role='checkbox' aria-checked='(true|false)'/)![1];
  snapshot = runtime.input("-9200");
  settle();
  const second = html().match(/value='-9200' class='era-toggle(?: era-on)?' role='checkbox' aria-checked='(true|false)'/)![1];
  assert.notEqual(first, second, "guard still toggles through the game's command");
});

test("item-use dialog shares inventory rows and filters owned usable items for each recipient", () => {
  const game = emptyGame();
  game.characters.set(0, { file: "<item-picker-character>", rows: [] });
  game.names.set("ITEM", new Map([["昆虫採集セット", 40]]));
  game.names.set("FLAG", new Map([["Cスキマ自動仕様", 1]]));
  const attributes = readFileSync(new URL("../hotpatch/INFO_PALAM.ERB", import.meta.url), "utf8");
  indexScript(game, attributes.slice(attributes.indexOf("@HOTPATCH_ATTRIBUTE(")), "<attribute-helper>");
  indexScript(game, readFileSync(new URL("../hotpatch/ITEM_LIST.ERB", import.meta.url), "utf8"), "<item-patch>");
  indexScript(game, `@SYSTEM_TITLE
#DIM recipient
#DIM page
ADDCHARA 0
ADDCHARA 0
ADDCHARA 0
MASTER = 1
TARGET = 2
CALLNAME:1 = Player <&>
CALLNAME:2 = Partner
ITEM:40 = 1
ITEM:120 = 3
ITEM:121 = 2
ITEM:122 = 1
ITEM:124 = 1
recipient = MASTER
CALL QoL_490_ITEMMENU(recipient, page)
PRINTFORML Selected: {RESULT}, recipient: {recipient}, stock: {ITEM:120}, {ITEM:121}
WAIT
@ITEMNAME_TR(ARG)
#FUNCTIONS
RETURNF ARG == 120 ? "Heal <&>" # "Food"
@ITEM_EXPLANATION(ARG)
#FUNCTIONS
RETURNF "It's helpful."
@ITEMTYPE(ARG)
#FUNCTION
RETURNF ARG == 121 ? 3 # 1
@使用可能アイテム(ARG)
#FUNCTION
RETURNF ARG == 120 ? 1 # (GROUPMATCH(ARG, 121, 122, 123) ? 2 # 0)
@ALTNAME_OR_CALLNAME(ARG)
#FUNCTIONS
RETURNF CALLNAME:ARG
@SHIRAHU(ARG)
#FUNCTION
RETURNF 1
@SHOW_MUSHI_CAGE
PRINTW Bug cage opened`, "<item-picker-fixture>");
  const html = (snapshot: ReturnType<Runtime["start"]>) => {
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const markup = snapshot.output.flatMap(item => item.type === "html" ? [item.text] : []).join("");
    assert.equal((markup.match(/<era-open/g) ?? []).length, (markup.match(/<era-close>/g) ?? []).length);
    return markup;
  };
  for (const jit of [false, true]) {
    const runtime = new Runtime(game, undefined, { jit });
    let markup = html(runtime.start());
    assert.match(markup, /era-dialog era-inventory era-item-use/);
    assert.match(markup, /Player &lt;&amp;&gt;/);
    assert.match(markup, /3 item types/);
    assert.match(markup, /value='120' class='era-inventory-item era-inventory-use' data-command-number='120' title='It&#39;s helpful\.'/);
    assert.match(markup, /data-command-number='120'[^>]*><span class='era-inventory-name'>Heal &lt;&amp;&gt;/);
    assert.match(markup, /title='Quantity'>3</);
    assert.match(markup, /Use on Partner/);
    assert.doesNotMatch(markup, /value='123'|value='124'|value='7777'|value='8888'/);
    assert.throws(() => runtime.input("124"), /displayed button/);
    markup = html(runtime.input("2001"));
    assert.match(markup, /era-current'>Heal/);
    assert.match(markup, /2 item types/);
    markup = html(runtime.input("9998"));
    assert.match(markup, /Use on Player &lt;&amp;&gt;/);
    assert.match(markup, /1 item type<\/span> · Heal/);
    assert.doesNotMatch(markup, /value='120'/, "self-only items are excluded with a nonzero MASTER");
    markup = html(runtime.input("2002"));
    assert.match(markup, /0 item types/);
    assert.match(markup, /No items in this category/);
    markup = html(runtime.input("2000"));
    assert.match(markup, /2 item types/);
    const automatic = runtime.input("9000");
    assert.equal(automatic.error, null);
    assert.doesNotMatch(html(automatic), /era-dialog/);
    assert.match(automatic.output.flatMap(item => "text" in item ? [item.text] : []).join(""), /switched ON/);
    markup = html(runtime.input(""));
    assert.match(markup, /Collector's Gap: ON/);
    const cage = runtime.input("9001");
    assert.doesNotMatch(html(cage), /era-dialog/);
    markup = html(runtime.input(""));
    assert.match(markup, /2 item types/);
    const selected = runtime.input("121");
    assert.doesNotMatch(html(selected), /era-dialog/, "the picker closes before item effects");
    assert.match(selected.output.flatMap(item => "text" in item ? [item.text] : []).join(""),
      /Selected: 121, recipient: 2, stock: 3, 2/);

    const cancelled = new Runtime(game, undefined, { jit });
    html(cancelled.start());
    const returned = cancelled.input("9999");
    assert.doesNotMatch(html(returned), /era-dialog/);
    assert.match(returned.output.flatMap(item => "text" in item ? [item.text] : []).join(""), /Selected: 999/);
  }
});

test("item picker passes selection to the game's existing item effects", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  assert.ok((await applyHotpatches(game)).includes("QoL_490_ITEMMENU"));
  const stub = emptyGame(game.root);
  indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
MASTER = 0
TARGET = 0
VARSET ITEM
ITEM:501 = 3
MAXBASE:0:体力 = 1000
MAXBASE:0:気力 = 1000
BASE:0:体力 = 10
BASE:0:気力 = 10
CALL COM490
PRINTFORML Stock: {ITEM:501}, HP: {BASE:0:体力}, drug: {TCVAR:0:お薬}
WAIT`, "<item-effect-test>");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const initial = runtime.start();
  assert.equal(initial.error, null, JSON.stringify(initial.error));
  assert.equal(initial.input?.kind, "integer");
  assert.ok(!initial.output.some(item => item.type === "text" && item.text === "Pick an item to use."));
  assert.ok(initial.input?.buttonValues.includes("501"));
  const selected = runtime.input("501");
  assert.equal(selected.error, null, JSON.stringify(selected.error));
  const output = selected.output.flatMap(item => "text" in item ? [item.text] : []).join("");
  assert.match(output, /Stock: 2, HP: \d+, drug: 1/);
  const hp = output.match(/HP: (\d+)/);
  assert.ok(hp && Number(hp[1]) > 10, "the existing effect restores health");
  assert.doesNotMatch(output, /era-dialog/, "item effects are not covered by the picker");

  const cooldownStub = emptyGame(game.root);
  indexScript(cooldownStub, `@SYSTEM_TITLE
ADDCHARA 0
MASTER = 0
TARGET = 0
VARSET ITEM
ITEM:121 = 2
CALL COM490
PRINTFORML Stock: {ITEM:121}
WAIT
@TIME_PROGRESS(ARG)
#FUNCTION
RETURNF 0`, "<item-cooldown-test>");
  game.routines.set("SYSTEM_TITLE", cooldownStub.routines.get("SYSTEM_TITLE")!);
  game.routines.set("TIME_PROGRESS", cooldownStub.routines.get("TIME_PROGRESS")!);
  const cooldown = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const picker = cooldown.start();
  assert.equal(picker.error, null, JSON.stringify(picker.error));
  assert.ok(picker.input?.buttonValues.includes("121"));
  const warning = cooldown.input("121");
  assert.equal(warning.error, null, JSON.stringify(warning.error));
  assert.equal(warning.input?.kind, "wait", "real cooldown warnings still need acknowledgement");
  assert.match(warning.output.flatMap(item => "text" in item ? [item.text] : []).join(""), /not hungry enough for a snack/);
  const reopened = cooldown.input("");
  assert.equal(reopened.error, null, JSON.stringify(reopened.error));
  assert.equal(reopened.input?.kind, "integer", "acknowledging the warning reopens item selection");
  const cancelled = cooldown.input("9999");
  assert.equal(cancelled.error, null, JSON.stringify(cancelled.error));
  assert.match(cancelled.output.flatMap(item => "text" in item ? [item.text] : []).join(""), /Stock: 2/);
});

test("inventory dialog supplies a live-filter footer and preserves categories, mods and items", {
  skip: !existsSync(GAME_ROOT),
}, async () => {
  const game = await loadGame();
  assert.ok((await applyHotpatches(game)).includes("QoL_AllItemSort"));
  const stub = emptyGame(game.root);
  indexScript(stub, `@SYSTEM_TITLE
ADDCHARA 0
MASTER = 0
CALLNAME:0 = Tester <&>
VARSET ITEM
ITEM:40 = 3
ITEM:36 = 1
CALL SHOW_ALLITEM
PRINTFORML Returned: {ITEM:40}, {ITEM:36}
WAIT`, "<inventory-test>");
  game.routines.set("SYSTEM_TITLE", stub.routines.get("SYSTEM_TITLE")!);
  const runtime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  const markup = (snapshot: ReturnType<Runtime["start"]>) => {
    assert.equal(snapshot.error, null, JSON.stringify(snapshot.error));
    const html = snapshot.output.flatMap((item) => item.type === "html" ? [item.text] : []).join("");
    assert.equal((html.match(/<era-open/g) ?? []).length, (html.match(/<era-close>/g) ?? []).length);
    return html;
  };
  let html = markup(runtime.start());
  assert.match(html, /era-dialog era-inventory/);
  assert.match(html, /Tester &lt;&amp;&gt;/);
  assert.match(html, /title='Quantity'>3</);
  assert.match(html, /2 item types/);
  assert.equal((html.match(/class='era-inventory-item'/g) ?? []).length, 2);
  assert.match(html, /value='3020'/);
  assert.match(html, /value='-9201' class='era-chip-button'>Auto Items</);
  assert.match(html, /era-inventory-footer'><span class='era-inventory-filter'><\/span>/);
  assert.match(html, /class='era-inventory-count'>2 item types</);
  assert.match(html, /class='era-inventory-item' title='Protects from the elements/);
  assert.match(html, /title='[^']*&#39;smoothly&#39;\.'/,
    "apostrophes do not truncate description tooltips");
  assert.doesNotMatch(html, /value='888'|era-inventory-description|Enter an item name/);

  html = markup(runtime.input("3002"));
  assert.match(html, /era-current'>Tools</);
  assert.match(html, /1 item type<\/span> · Tools/);
  html = markup(runtime.input("3016"));
  assert.match(html, /No items in this category/);
  assert.match(html, /0 item types/);
  assert.match(html, /value='999' class='era-dialog-close'/);
  html = markup(runtime.input("3000"));
  assert.match(html, /2 item types/);
  const mods = runtime.input("777");
  html = markup(mods);
  assert.match(html, /Back to items/);
  assert.match(mods.output.flatMap((item) => "text" in item ? [item.text] : []).join(""), /Umbrella/i);
  html = markup(runtime.input("889"));
  assert.match(html, /2 item types/);
  const automatic = runtime.input("-9201");
  assert.equal(automatic.error, null, JSON.stringify(automatic.error));
  assert.match(automatic.output.flatMap((item) => "text" in item ? [item.text] : []).join(""), /Choose which items to use/);
  html = markup(runtime.input("-1"));
  assert.match(html, /2 item types/, "closing Auto Items returns to the current inventory");
  assert.throws(() => runtime.input("-1"), /displayed button/);
  const snapshot = runtime.input("999");
  assert.equal(snapshot.error, null);
  assert.match(snapshot.output.flatMap((item) => "text" in item ? [item.text] : []).join(""), /Returned: 3, 1/);

  const emptyStub = emptyGame(game.root);
  indexScript(emptyStub, "@SYSTEM_TITLE\nADDCHARA 0\nVARSET ITEM\nCALL SHOW_ALLITEM\nWAIT", "<empty-inventory-test>");
  game.routines.set("SYSTEM_TITLE", emptyStub.routines.get("SYSTEM_TITLE")!);
  const emptyRuntime = new Runtime(game, GAME_INSTRUCTION_LIMIT);
  html = markup(emptyRuntime.start());
  assert.match(html, /0 item types/);
  assert.match(html, /No items in this category/);
  html = markup(emptyRuntime.input("777"));
  assert.match(html, /You do not own any moddable items/);
});
