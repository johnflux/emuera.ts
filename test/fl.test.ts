import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compatibility } from "../src/compatibility.js";
import { displayMetrics, emptyGame, GAMES_DIR, indexScript, loadGame } from "../src/loader.js";
import { GAME_INSTRUCTION_LIMIT, Runtime, type Snapshot } from "../src/runtime.js";
import { MemorySaveStore } from "../src/storage.js";

function game(source: string) {
  const game = emptyGame();
  indexScript(game, source, "fl.ERB");
  return game;
}
function text(snapshot: Snapshot): string {
  assert.notEqual(snapshot.status, "error", JSON.stringify(snapshot.error));
  return snapshot.output.filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

test("routine declarations allow a trailing comma without creating an empty parameter", () => {
  for (const jit of [false, true]) {
    const value = game(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
  PRINTFORML {CHECK(3,, "tag")} {CHECK(3)}
  CALL LEGACY(7)
  PRINTFORML {RESULT}
NEXT
RETURN
@CHECK(VALUE, MODE = "AND", TAGS:0 = "", TAGS:1 = "",)
#FUNCTION
#DIM VALUE
#DIMS MODE
#DIMS TAGS, 2
RETURNF VALUE + (MODE == "AND") + (TAGS:0 == "tag") + (TAGS:1 == "")
@LEGACY, ARG:0,
RETURN ARG:0`);
    assert.deepEqual(value.routines.get("CHECK")?.[0]?.parameters,
      ["VALUE", 'MODE = "AND"', 'TAGS:0 = ""', 'TAGS:1 = ""']);
    assert.equal(text(new Runtime(value, 50_000, { jit }).start()), Array(4).fill("6 5\n7").join("\n"));
  }
});

test("VARI/VARS create per-call variables before execution and reinitialize at each declaration", () => {
  for (const jit of [false, true]) {
    const value = game(`@SYSTEM_TITLE
#DIM VALUE = 99
FOR LOCAL, 0, 4
  CALL SHOW
NEXT
PRINTFORML {VALUE}
RETURN
@SHOW
#DIM EXISTING = 8
PRINTFORML {VALUE} [%WORD%]
VARI VALUE = NEXT_VALUE()
VARS WORD = "hello"
VARS WORDS, 3
VARI GRID, 2, 3
WORDS:2 = "old"
GRID:1:2 = 9
VARS WORDS, 3
VARI GRID, 2, 3
PRINTFORML {VALUE} [%WORD%] [%WORDS:2%] {GRID:1:2}
VARI EXISTING
PRINTFORML {EXISTING}
RETURN
@NEXT_VALUE
#FUNCTION
RETURNF 7`);
    const report = compatibility(value);
    assert.deepEqual(report.gaps, []);
    const result = new Runtime(value, 50_000, { jit }).start();
    assert.equal(result.status, "halted", JSON.stringify(result.error));
    assert.equal(text(result), Array(4).fill("0 []\n7 [hello] [] 0\n0").join("\n") + "\n99");
  }
});

test("inline declarations isolate recursion, initialize only on reached paths and survive suspension", () => {
  for (const jit of [false, true]) {
    const runtime = new Runtime(game(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
  CALL RECURSE(3)
NEXT
CALL SUSPEND
PRINTFORML {LABEL(2)}
RETURN
@RECURSE(ARG)
VARI VALUE = ARG
IF ARG > 0
  CALL RECURSE(ARG - 1)
ENDIF
PRINTFORML {VALUE}
RETURN
@SUSPEND
IF 0
  VARI UNREACHED = MISSING()
ENDIF
PRINTFORML {UNREACHED}
VARI KEPT = 11
WAIT
PRINTFORML {KEPT}
RETURN
@LABEL(ARG)
#FUNCTION
VARI VALUE = ARG + 1
RETURNF VALUE`), 50_000, { jit });
    const first = runtime.start();
    assert.equal(first.status, "waiting", JSON.stringify(first.error));
    assert.equal(text(first), Array(4).fill("0\n1\n2\n3").join("\n") + "\n0");
    const last = runtime.input("");
    assert.equal(last.status, "halted", JSON.stringify(last.error));
    assert.equal(text(last), "11\n3");
  }
});

test("inline declarations validate syntax, sizes, initializer types and constant writes with locations", () => {
  for (const jit of [false, true]) {
    for (const statement of [
      "VARI", "VARS", "VARI BAD, 0", "VARI BAD, -1", "VARI BAD, 1000001",
      "VARI BAD, 1, 1, 1, 1", "VARI BAD, A", "VARI BAD EXTRA",
      'VARI BAD = "wrong"', "VARS BAD = 1", "VARI BAD = MISSING()",
      "#DIM CONST BAD = 1\nVARI BAD",
    ]) {
      const result = new Runtime(game(`@SYSTEM_TITLE\n${statement}`), 50_000, { jit }).start();
      assert.equal(result.status, "error", statement);
      assert.equal(result.error!.file, "fl.ERB");
    }
  }
});

test("LASTLOAD metadata starts at -1, tracks successful saves, and resets with RESETDATA", () => {
  for (const jit of [false, true]) {
    const value = game(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
  CALL SHOW
NEXT
SAVEDATA 3, "description"
CHKDATA 3
CALL SHOW
LOADDATA 3
RETURN
@SHOW
PRINTFORML {LASTLOAD_VERSION} {LASTLOAD_NO} [%LASTLOAD_TEXT%]
RETURN
@EVENTLOAD
FOR LOCAL, 0, 4
  CALL SHOW
NEXT
RESETDATA
CALL SHOW
QUIT`);
    value.tables.set("GAMEBASE", new Map([[0, ["バージョン", "4903"]]]));
    const saves = new MemorySaveStore();
    const result = new Runtime(value, 50_000, { jit, saves }).start();
    assert.equal(result.status, "halted", JSON.stringify(result.error));
    assert.equal(text(result), [
      ...Array(5).fill("-1 -1 []"), ...Array(4).fill("4903 3 [description]"), "-1 -1 []",
    ].join("\n"));
  }
});

test("LASTLOAD_VERSION reports the saved version rather than the running game's newer version", () => {
  const saves = new MemorySaveStore();
  const old = game('@SYSTEM_TITLE\nSAVEDATA 7, "old version"');
  old.tables.set("GAMEBASE", new Map([[0, ["バージョン", "4903"]]]));
  assert.equal(new Runtime(old, 50_000, { saves }).start().status, "halted");
  const current = game(`@SYSTEM_TITLE
LOADDATA 7
@EVENTLOAD
PRINTFORML {GAMEBASE_VERSION} {LASTLOAD_VERSION} {LASTLOAD_NO} [%LASTLOAD_TEXT%]
QUIT`);
  current.tables.set("GAMEBASE", new Map([
    [0, ["バージョン", "5000"]], [1, ["バージョン違い認める", "4903"]],
  ]));
  const loaded = new Runtime(current, 50_000, { saves }).start();
  assert.equal(loaded.status, "halted", JSON.stringify(loaded.error));
  assert.equal(text(loaded), "5000 4903 7 [old version]");
});

const root = path.join(GAMES_DIR, "erafl");
test("default, user and fixed config layers enable case-insensitive XML reads without allowing other extensions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-config-"));
  try {
    await mkdir(path.join(root, "CSV"));
    await mkdir(path.join(root, "ERB"));
    await mkdir(path.join(root, "XML"));
    await writeFile(path.join(root, "XML", "schema.xml"), "<schema/>");
    await writeFile(path.join(root, "XML", "blocked.csv"), "blocked");
    await writeFile(path.join(root, "CSV", "default.config"), "フォントサイズ:14\nLOADTEXTとSAVETEXTで使える拡張子:txt,xml");
    await writeFile(path.join(root, "CSV", "_default.config"), "\uFEFF; ignored:comment\nフォントサイズ:16\nLOADTEXTとSAVETEXTで使える拡張子:txt,xml");
    await writeFile(path.join(root, "ERB", "title.erb"), `@SYSTEM_TITLE
PRINTSL LOADTEXT("xml/SCHEMA.XML")
PRINTSL LOADTEXT("XML\\\\schema.xml")
PRINTSL LOADTEXT("XML/blocked.csv")
PRINTSL LOADTEXT("../outside.xml")`);
    const defaults = await loadGame(root);
    assert.equal(displayMetrics(defaults).fontSize, 16);
    assert.equal(text(new Runtime(defaults).start()), "<schema/>\n<schema/>\n\n");
    await writeFile(path.join(root, "emuera.config"), "Font size:20");
    assert.equal(displayMetrics(await loadGame(root)).fontSize, 20);
    await writeFile(path.join(root, "CSV", "fixed.config"), "フォントサイズ:22");
    assert.equal(displayMetrics(await loadGame(root)).fontSize, 22);
    await writeFile(path.join(root, "CSV", "_fixed.config"), "FontSize:24");
    assert.equal(displayMetrics(await loadGame(root)).fontSize, 24);
    await rm(path.join(root, "CSV", "_default.config"));
    await rm(path.join(root, "emuera.config"));
    await rm(path.join(root, "CSV", "_fixed.config"));
    await rm(path.join(root, "CSV", "fixed.config"));
    assert.equal(displayMetrics(await loadGame(root)).fontSize, 14);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("TOOLTIP_FORMAT sends alignment changes and rejects unsupported formats explicitly", () => {
  for (const jit of [false, true]) {
    const runtime = new Runtime(game(`@SYSTEM_TITLE
TOOLTIP_CUSTOM 1
FOR LOCAL, 0, 4
  CALL FORMAT(LOCAL)
NEXT
RETURN
@FORMAT(ARG)
TOOLTIP_FORMAT ARG
INPUT`), 50_000, { jit });
    let snapshot = runtime.start();
    for (const format of [0, 1, 2]) {
      assert.equal(snapshot.status, "waiting", JSON.stringify(snapshot.error));
      assert.equal(snapshot.tooltip?.format, format);
      snapshot = runtime.input("0");
    }
    assert.equal(snapshot.status, "error");
    assert.match(snapshot.error!.message, /TOOLTIP_FORMAT supports/);
    for (const argument of ["", "-1", '"wrong"', "0, 1"]) {
      assert.equal(new Runtime(game(`@SYSTEM_TITLE\nTOOLTIP_FORMAT ${argument}`)).start().status, "error");
    }
  }
});

test("HTML_PRINT's optional buffer flag appends inline HTML without flushing the current line", () => {
  for (const jit of [false, true]) {
    const runtime = new Runtime(game(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
  CALL SHOW
NEXT
RETURN
@SHOW
PRINT before
HTML_PRINT @"<b>inline,{LOCAL}</b>", 1
PRINT after
PRINTL
HTML_PRINT "<i>standalone</i>", 0`), 50_000, { jit });
    const snapshot = runtime.start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    const html = snapshot.output.filter((item) => item.type === "html");
    assert.deepEqual(html.map((item) => item.newline), Array(4).fill([false, true]).flat());
    assert.equal(snapshot.output.filter((item) => item.type === "text").length, 12);
  }
  const bad = new Runtime(game('@SYSTEM_TITLE\nHTML_PRINT "html", 1, 2')).start();
  assert.equal(bad.status, "error");
  assert.match(bad.error!.message, /HTML_PRINT expects/);
});

test("erafl new game loads schemas and reaches companion selection with tooltip formatting", {
  skip: !existsSync(root),
}, async () => {
  const value = await loadGame(root);
  const gaps = compatibility(value).gaps;
  assert.deepEqual(gaps.map((gap) => [gap.feature, gap.count]), [["Instruction: CALLSHARP", 3]]);
  assert.equal(value.config.get("LOADTEXTとSAVETEXTで使える拡張子"), "txt,xml");
  const runtime = new Runtime(value, GAME_INSTRUCTION_LIMIT);
  const title = runtime.start();
  assert.equal(title.status, "waiting", JSON.stringify(title.error));
  assert.equal(title.input?.kind, "integer");
  const initialized = runtime.input("0");
  assert.equal(initialized.status, "waiting", JSON.stringify(initialized.error));
  assert.equal(initialized.input?.kind, "integer");
  assert.match(text(initialized), /一緒にゲームを開始する仲間を選択してください/);
  assert.doesNotMatch(text(initialized), /スキーマ定義が存在しない/);
  assert.equal(initialized.tooltip?.format, 0);
  const companions = runtime.input("0");
  assert.equal(companions.status, "waiting", JSON.stringify(companions.error));
  assert.equal(companions.input?.kind, "string");
  assert.match(text(companions), /対象キャラクターを選択してください/);
  assert.ok(companions.output.some((item) => item.type === "html" && item.text.includes("<div")));
  assert.ok(companions.output.some((item) => item.type === "button" && item.text === "[このキャラにする]"));
  indexScript(value, `@CHECK_INITIALIZATION
CALL INIT_NEWGAME
PRINTFORML {DT_ROW_LENGTH("GLOBAL_GOAL")} {XML_EXIST(XMLID_SKILL_BATTLE)}`, "check-initialization.ERB");
  const checked = new Runtime(value, GAME_INSTRUCTION_LIMIT).start("CHECK_INITIALIZATION");
  assert.equal(checked.status, "halted", JSON.stringify(checked.error));
  assert.match(text(checked), /^[1-9]\d* 1$/);
  indexScript(value, `@CHECK_SHOP_MONEY
PRINTSL MONEY_FORMAT(1234567)
PRINTSL MONEY_FORMAT(-1234567)
PRINTSL MONEY_FORMAT(0)`, "check-shop-money.ERB");
  assert.equal(text(new Runtime(value).start("CHECK_SHOP_MONEY")), "$1,234,567\n-$1,234,567\n$0");
  indexScript(value, `@CHECK_WINDOW_DIMENSIONS
FOR LOCAL, 0, 4
CALL WndMgr_WindowMgrMain("EXIST", 0, 0, "")
PRINTFORML {RESULT}
NEXT
VARSIZE m_arrWndText
PRINTFORML {RESULT:0} {RESULT:1}
VARSIZE m_arrWndPropN
PRINTFORML {RESULT:0} {RESULT:1}
CALL WndMgr_CreateWindow(0, 0, 0, 32, 10, 1)
CALL WndMgr_TextSet(0, 0, "window text")
PRINTSL m_arrWndText:0:0
CALL WndMgr_Exist(0)
PRINTFORML {RESULT}
CALL WndMgr_DestroyWindow(0)
CALL WndMgr_Exist(0)
PRINTFORML {RESULT}`, "check-window-dimensions.ERB");
  for (const jit of [false, true]) {
    assert.equal(text(new Runtime(value, GAME_INSTRUCTION_LIMIT, { jit }).start("CHECK_WINDOW_DIMENSIONS")),
      "0\n0\n0\n0\n100 102\n100 20\nwindow text\n1\n0");
  }
  indexScript(value, `@CHECK_CONDITION_TAG
#DIMS KEYS, 3
ADDVOIDCHARA
KEYS:1 '= "下着下"
KEYS:2 '= "missing-tag"
調教用衣装:0:衣装部位_下着下 = 26
FOR LOCAL, 0, 4
PRINTFORML {HAS_CLOTH_TAG(0, 0,, "missing-tag")}
PRINTFORML {C_COND_CLOTH(0, KEYS)}
NEXT`, "check-condition-tag.ERB");
  for (const jit of [false, true]) {
    assert.equal(text(new Runtime(value, GAME_INSTRUCTION_LIMIT, { jit }).start("CHECK_CONDITION_TAG")),
      Array(8).fill("0").join("\n"));
  }
});

test("eraFL XML mutations update string variables and stored documents in interpreted and JIT routines", () => {
  for (const jit of [false, true]) {
    const value = game(`@SYSTEM_TITLE
FOR LOCAL, 0, 4
CALL MUTATE
NEXT
RETURN
@MUTATE
VARS XML = "<r><item id='1'/><item id='2'/></r>"
VARS OUT, 4
XML_SET XML, "/r/item", "unchanged", 0, 1
PRINTFORML {RESULT}
XML_SET XML, "/r/item", "a & b", 1, 1
XML_ADDATTRIBUTE XML, "/r/item", "x", "10", 0, 1
XML_ADDATTRIBUTE XML, "/r/item/@x", "y", "20", 1, 1
XML_REMOVEATTRIBUTE XML, "/r/item/@id", 1
XML_GET XML, "/r/item", OUT, 3
PRINTSL OUT:0
PRINTSL OUT:1
XML_SET XML, "/r/item[1]", "<b>new</b>", 0, 2
XML_REPLACE XML, "/r/item[2]", "<other value='ok'/>"
PRINTSL XML
XML_DOCUMENT "named", XML
XML_SET_BYNAME "named", "/r/other/@value", "changed"
XML_ADDATTRIBUTE_BYNAME "named", "/r/other", "empty"
XML_REMOVEATTRIBUTE_BYNAME "named", "/r/other/@empty"
XML_REPLACE_BYNAME "named", "/r/item", "<first/>"
PRINTSL XML_TOSTR("named")
XML_REPLACE "named", "<whole/>"
PRINTSL XML_TOSTR("named")
XML_RELEASE "named"
PRINTFORML {XML_SET(99, "/r", "x")} {XML_REPLACE(99, "<r/>")}
RETURN`);
    assert.deepEqual(compatibility(value).gaps, []);
    assert.equal(text(new Runtime(value, 50_000, { jit }).start()), Array(4).fill([
      "2", '<item y="20" x="10">a &amp; b</item>', '<item y="20" x="10">a &amp; b</item>',
      '<r><item y="20" x="10"><b>new</b></item><other value="ok" /></r>',
      '<r><first /><other value="changed" /></r>', "<whole />", "-1 -1",
    ].join("\n")).join("\n"));
  }
});

test("XML mutations validate arguments and malformed input with script diagnostics", () => {
  const leaves = new Runtime(game(`@SYSTEM_TITLE
VARS XML = "<r a='old'>old<!--note--></r>"
XML_SET XML, "/r/@a", "new"
XML_SET XML, "/r/text()", "new & text"
XML_SET XML, "/r/comment()", "changed"
PRINTSL XML`)).start();
  assert.equal(text(leaves), '<r a="new">new &amp; text<!--changed--></r>');
  for (const [command, expected] of [
    ['XML_SET XML, "/r", "<bad>", 0, 2', /Invalid XML/],
    ['XML_REPLACE XML, "/r", "<bad>"', /Invalid XML/],
    ['XML_ADDATTRIBUTE XML, "/r", "not a name", ""', /Invalid XML attribute name/],
    ['XML_REMOVEATTRIBUTE XML, "???", 1', /Invalid XPath/],
    ['XML_SET XML, "/r", "value"', /no Value/],
    ['XML_REPLACE 0', /Invalid number of arguments/],
  ] as const) {
    const result = new Runtime(game(`@SYSTEM_TITLE\nVARS XML = "<r/>"\n${command}`)).start();
    assert.equal(result.status, "error", command);
    assert.match(result.error!.message, expected);
    assert.equal(result.error!.file, "fl.ERB");
    assert.equal(result.error!.line, 3);
  }
});

test("MAP_CLEAR and MAP_FROMXML merge native map XML, preserve nested values and return status", () => {
  for (const jit of [false, true]) {
    const value = game(`@SYSTEM_TITLE
MAP_CREATE "m"
MAP_SET "m", "kept", "old"
PRINTFORML {MAP_CLEAR("missing")} {MAP_FROMXML("missing", "not parsed")}
FOR LOCAL, 0, 4
  CALL IMPORT
NEXT
MAP_CLEAR "m"
PRINTFORML {RESULT} {MAP_SIZE("m")}
RETURN
@IMPORT
MAP_FROMXML "m", "<map><p><k>a</k><v>1</v></p><p><k>a</k><v><bonus v='2'/></v></p><p><k>b</k></p></map>"
PRINTFORML {RESULT} {MAP_SIZE("m")} [%MAP_GET("m", "kept")%] [%MAP_GET("m", "a")%]
RETURN`);
    assert.deepEqual(compatibility(value).gaps, []);
    assert.equal(text(new Runtime(value, 50_000, { jit }).start()), "-1 0\n"
      + Array(4).fill('1 2 [old] [<bonus v="2" />]').join("\n") + "\n1 0");
    const invalid = new Runtime(game('@SYSTEM_TITLE\nMAP_CREATE "m"\nMAP_FROMXML "m", "<map>"')).start();
    assert.equal(invalid.status, "error");
    assert.match(invalid.error!.message, /Invalid XML/);
  }
});

test("GDRAWGWITHROTATE keeps world transforms across later drawing and full clears", () => {
  const value = game(`@SYSTEM_TITLE
GCREATE 1, 11, 9
GCREATE 2, 20, 20
GCLEAR 1, 0xFFFF0000
GDRAWGWITHROTATE 2, 1, 90
GDRAWLINE 2, 0, 0, 1, 1
GSETCOLOR 2, 0xFFFFFFFF, 1, 2
SPRITECREATE "BEFORE", 2
HTML_PRINT "<img src='BEFORE'>"
GCLEAR 2, 0xFF0000FF
GDRAWGWITHROTATE 2, 1, -90, 5, 4
SPRITECREATE "AFTER", 2
HTML_PRINT "<img src='AFTER'>"
PRINTFORML {RESULT} {GDRAWGWITHROTATE(99, 1, 90)}`);
  assert.deepEqual(compatibility(value).gaps, []);
  const result = new Runtime(value).start();
  assert.equal(text(result), "1 0");
  const html = result.output.filter((item) => item.type === "html");
  const before = html[0]?.sprites?.["BEFORE"]?.picture.ops[0];
  const after = html[1]?.sprites?.["AFTER"]?.picture.ops[0];
  assert.ok(before?.op === "graphics" && after?.op === "graphics");
  assert.deepEqual(before.source.ops.map((op) => op.op), ["rotate", "graphics", "line", "fill"]);
  assert.deepEqual(before.source.ops[3], { op: "fill", color: "rgba(255, 255, 255, 1)", rect: [1, 2, 1, 1], replace: true, absolute: true });
  assert.deepEqual(before.source.ops[0], { op: "rotate", angle: 90, x: 5, y: 4 });
  assert.deepEqual(after.source.ops.map((op) => op.op), ["fill", "rotate", "rotate", "graphics"]);
  const invalid = new Runtime(game("@SYSTEM_TITLE\nGDRAWGWITHROTATE 2, 1, 90, 5")).start();
  assert.match(invalid.error!.message, /3 or 5 arguments/);
});

test("sound volumes clamp to 0..100 and playback snapshots preserve updates and stop commands", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-sound-"));
  try {
    await mkdir(path.join(root, "sound"));
    await writeFile(path.join(root, "sound", "Bgm theme.ogg"), "");
    const value = game(`@SYSTEM_TITLE
RESULT = 42
SETBGMVOLUME 150
SETSOUNDVOLUME -2
PLAYBGM "bgm theme.OGG"
PLAYSOUND "bgm theme.ogg", 2
WAIT
SETBGMVOLUME 25
SETSOUNDVOLUME 60
WAIT
STOPBGM
STOPSOUND
PRINTFORML {RESULT}
RETURN`);
    value.root = root;
    value.resourceBase = "/games/fl/resources/";
    assert.deepEqual(compatibility(value).gaps, []);
    const runtime = new Runtime(value);
    const first = runtime.start();
    text(first);
    assert.ok(first.audio?.bgm);
    assert.equal(first.audio.bgm.url, "/games/fl/sound/Bgm%20theme.ogg");
    assert.deepEqual([first.audio.bgmVolume, first.audio.soundVolume], [100, 0]);
    assert.equal(first.audio.sounds[0]?.repeat, 2);
    const second = runtime.input("");
    text(second);
    assert.deepEqual(second.audio, { ...first.audio, soundVolume: 60, bgmVolume: 25, sounds: [], stopSounds: false });
    const third = runtime.input("");
    assert.equal(text(third), "42");
    assert.deepEqual(third.audio, { soundVolume: 60, bgmVolume: 25, bgm: null, sounds: [], stopSounds: true });
    for (const command of ["SETBGMVOLUME", "SETSOUNDVOLUME 1, 2", 'PLAYBGM "../escape.wav"', "STOPSOUND 1"]) {
      const bad = new Runtime(game(`@SYSTEM_TITLE\n${command}`)).start();
      assert.equal(bad.status, "error", command);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
