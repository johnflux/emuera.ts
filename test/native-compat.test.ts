import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { csvRows, emptyGame, indexScript, loadGame } from "../src/loader.js";
import { Runtime } from "../src/runtime.js";
import { regexCharacterClasses, regexGroupOrder, replaceRegex } from "../src/regex.js";

test("native EE control-flow results match in interpreted and warmed JIT routines", async () => {
  const source = await readFile(new URL("./fixtures/native-control-flow.erb", import.meta.url), "utf8");
  const expected = [
    "SHORT 1 0 0 1",
    "EVAL 0 0 3",
    "FALL 0 77",
    "FUN 3 88",
    "BREAK 1 7 1",
    "TRAIL_EXPR 8 13 13",
    "TRAIL_CALL 8",
    "TRAIL_REPEAT 2",
    "ASSIGN 7 6",
    "DEFAULT -1",
  ];
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, source, "native-control-flow.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter((line) => line.type === "text").map((line) => line.text),
      [...Array.from({ length: 5 }, () => expected).flat(), "DONE", "Log written to emuera.log"]);
  }
});

test("scripts and CSVs accept CRLF, LF, lone CR and mixed line endings", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    const game = emptyGame();
    indexScript(game, ["@SYSTEM_TITLE", "CALL VALUE", "PRINTFORML {RESULT}", "QUIT", "@VALUE", "RETURN 7"].join(ending), "lines.erb");
    const snapshot = new Runtime(game).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter((line) => line.type === "text").map((line) => line.text), ["7"]);
    assert.equal(game.routines.get("VALUE")?.[0]?.line, 5);
    assert.deepEqual(csvRows(`1,first${ending}2,second${ending}`), [["1", "first"], ["2", "second"]]);
  }
  assert.deepEqual(csvRows("1,first\r\n2,second\r3,third\n4,fourth"), [
    ["1", "first"], ["2", "second"], ["3", "third"], ["4", "fourth"],
  ]);
});

test("native EE string, regex substitution and Unicode results match in both execution modes", async () => {
  const source = await readFile(new URL("./fixtures/native-string-builtins.erb", import.meta.url), "utf8");
  const expected = [
    "WIDTH 2 2",
    "STRCMP 0 0 0 1 1 1 1",
    "REPLACEMENT [xx9] [y] [x9]",
    "GROUPS [$12] [xy] [y,x]",
    "UNMATCHED [] [] [$9]",
    "ESCAPE [a\\ \\#b]]",
    "REGEX_CLASSES 1 1 4",
  ];
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, source, "native-string-builtins.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter((line) => line.type === "text").map((line) => line.text),
      [...Array.from({ length: 5 }, () => expected).flat(), "DONE", "Log written to emuera.log"]);
  }
});

test("trailing separators retain interior omissions and reject extra nonempty arguments", () => {
  for (const call of ["ONE(1,2,)", "ONE(1,,,)"]) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE\nPRINTFORML {${call}}\n@ONE(ARG)\n#FUNCTION\nRETURNF ARG`, "args.erb");
    const snapshot = new Runtime(game).start();
    assert.equal(snapshot.status, "error");
    assert.match(snapshot.error!.message, /Too many arguments/);
  }
});

test("native EE numeric validation and conversion keep their distinct parsing rules", async () => {
  const source = await readFile(new URL("./fixtures/native-numeric-builtins.erb", import.meta.url), "utf8");
  const expected = [
    "INVALID 0 0 0 0 0 0",
    "SIGNS 1 1 0 0 0",
    "DECIMAL 7 -7 300 12 400 1",
    "BASES 16 5 200 131072",
    "FRACTIONS 1 1 0 1 100",
    "LIMITS 9223372036854775807 -9223372036854775808 -1 -9223372036854775808",
    "ZERO 0 0 0 0 0 0",
  ];
  for (const jit of [false, true]) {
    const game = emptyGame();
    indexScript(game, source, "native-numeric-builtins.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
    assert.deepEqual(snapshot.output.filter((line) => line.type === "text").map((line) => line.text),
      [...Array.from({ length: 5 }, () => expected).flat(), "DONE", "Log written to emuera.log"]);
  }
});

test("numeric overflow and malformed conversions report errors, including in warmed JIT routines", () => {
  const cases: [string, RegExp][] = [
    ['ISNUMERIC("9223372036854775808")', /64-bit integer range/],
    ['TOINT("-9223372036854775809")', /64-bit integer range/],
    ['TOINT("0x10000000000000000")', /64-bit integer range/],
    ['ISNUMERIC("1e19")', /64-bit integer range/],
    ['TOINT("4e")', /cannot be converted/],
    ['ISNUMERIC("0b2")', /Binary notation/],
  ];
  for (const jit of [false, true]) for (const [expression, error] of cases) {
    const game = emptyGame();
    indexScript(game, `@SYSTEM_TITLE
FOR A, 0, 5
CALL PROBE
NEXT
QUIT
@PROBE
IF A >= 4
PRINTFORML {${expression}}
ENDIF
RETURN`, "numeric-errors.erb");
    const snapshot = new Runtime(game, 50_000, { jit }).start();
    assert.equal(snapshot.status, "error", `${expression}, jit=${jit}`);
    assert.match(snapshot.error!.message, error);
    assert.equal(snapshot.error!.file, "numeric-errors.erb");
    assert.equal(snapshot.error!.line, 8);
  }
});

test(".NET regex substitutions preserve undefined groups and order named captures last", () => {
  assert.equal(replaceRegex("axyz", /(?<first>x)(y)/gu, "$$|$&|$`|$'|$_|$+|$0|$1|$2|${first}|$12|${missing}"),
    "a$|xy|a|z|axyz|x|xy|y|x|x|$12|${missing}z");
  assert.equal(replaceRegex("y", /(x)?y/gu, "$1|$+|$9"), "||$9");
  assert.equal(replaceRegex("a", /a/gu, "$+"), "a");
  assert.equal(replaceRegex("aba", /a/gu, "[$_]"), "[aba]b[aba]");
  assert.equal(replaceRegex("a", /(?:)/gu, "_"), "_a_");
  assert.deepEqual(regexGroupOrder(/[(](?<first>x)(?:y)(z)\((?<second>k)/gu), [0, 2, 1, 3]);
});

test(".NET regex classes work inside character classes and leave escaped backslashes literal", () => {
  for (const [pattern, source, expected] of [
    [String.raw`[\w]+`, "漢٣_", ["漢٣_"]],
    [String.raw`[^\W]+`, "漢٣_!", ["漢٣_"]],
    [String.raw`\D+`, "٣漢", ["漢"]],
    [String.raw`\S+`, "a\u0085b", ["a", "b"]],
    [String.raw`\\w`, String.raw`\w漢`, [String.raw`\w`]],
    [String.raw`\B`, "x漢 y", [""]],
  ] as const) {
    assert.deepEqual([...source.matchAll(new RegExp(regexCharacterClasses(pattern), "gu"))].map((match) => match[0]), expected);
  }
});

test("script discovery honors layered subdirectory config and loads root definitions before nested ones", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "era-native-loader-"));
  try {
    await mkdir(path.join(root, "CSV"));
    await mkdir(path.join(root, "ERB", "child"), { recursive: true });
    await writeFile(path.join(root, "ERB", "main.erb"),
      "@SYSTEM_TITLE\nCALL PICK\nPRINTFORML {RESULT}\nQUIT\n@PICK\nRETURN 10");
    await writeFile(path.join(root, "ERB", "child", "child.erb"),
      "@PICK\nRETURN 20\n@ONLY_NESTED\nRETURN 30");
    for (const search of [undefined, "NO", "YES"]) {
      if (search) await writeFile(path.join(root, "emuera.config"), `サブディレクトリを検索する:${search}\r読み込み順をファイル名順にソートする:YES\r`);
      const game = await loadGame(root);
      assert.equal(game.scriptFiles, search === "YES" ? 2 : 1);
      assert.equal(game.routines.has("ONLY_NESTED"), search === "YES");
      const snapshot = new Runtime(game).start();
      assert.equal(snapshot.status, "halted", JSON.stringify(snapshot.error));
      assert.deepEqual(snapshot.output.filter((line) => line.type === "text").map((line) => line.text), ["10"]);
    }
    await writeFile(path.join(root, "CSV", "_fixed.config"), "サブディレクトリを検索する:NO\r");
    assert.equal((await loadGame(root)).scriptFiles, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
