# Game patches

Emuera.ts runs `anon-tw-anon-tw_eng-modding` as-is and implements Emuera's
behaviour faithfully, including when the game itself is wrong. The fixes below
are for **bugs in the game's own data and scripts**. Each one was checked
against EvilMask's Emuera (EM) source, so the same symptom appears in the real
`Emuera.exe`. Nothing in the interpreter was changed for them.

The game folder is git-ignored, so the patch is reproduced in full at the end
of this document. Re-apply it after updating or reinstalling the game.

| # | Symptom | Cause | Files |
|---|---------|-------|-------|
| 1 | "Ego alert! Biten has Relation towards herself!" on every load | Typo in Biten's CSV: her affinity for Ubame uses Biten's number | `CSV/Chara/Chara153 美天.csv`, `ERB/TRANSLATION/Addition/Add_Relation.ERB` |
| 2 | After "You simply can't enter." the map's bottom row (`[C] - Change Display Mode`, `Change Map`, `Return`) disappears | `CLEARLINE 2` assumes the typed input is on its own line, but it shares the last menu row | `ERB/コマンド関連/COMF/日常系/COMF400 移動.ERB` |

## 1. Biten's self-relation ("Ego alert!")

### Symptom

Loading a save (for example [1] Continue) prints in red:

```
Ego alert! Biten has Relation towards herself!
Apply [Update] for fixes with Relation patch, or report this if it doesn't fix the problem.
```

Running [Update] does not help.

### Cause

- `Chara153 美天.csv` (Son Biten, `番号,153`) contains
  `相性,153,120;ウバメ`. The comment says the affinity is meant for Ubame, but
  Ubame is character **159** (`Chara159 ウバメ.csv`, `番号,159`). The other
  characters that list Ubame (`Chara119 ネムノ.csv`, `Chara160 チミ.csv`) use
  `相性,159,…` correctly. So Biten gets `RELATION:153 = 120`, which is an
  affinity towards herself.
- Emuera accepts the line. A `相性,N,V` entry is skipped only when `N` is
  outside the RELATION array, and `VariableSize.csv` sets `RELATION,500`.
- The game's own check, `@EVENTLOAD` in `Add_Relation.ERB`, warns for any
  character slot `i` with `RELATION:i:i != 0`. Biten is in slot 153, so it
  fires every time a save is loaded.
- [Update] calls `ADD_SET_RELATION_PROC`, which has no case for Biten, so it
  never clears the value.

### Fix

1. **CSV:** change the entry to `相性,159,120;ウバメ`. New games create Biten
   with the intended affinity.
2. **Existing saves:** each saved character stores its own RELATION array, so
   saves made before the CSV fix still contain `RELATION:153 = 120`. The patch
   adds a one-time repair at the top of the same `@EVENTLOAD`, before the
   check:
   - it finds the character whose `NO` is 153;
   - it moves the misplaced 120 to slot 159, but only if Ubame's slot is still
     unset, so values the player earned are kept;
   - it clears slot 153.

   The repair does nothing on fixed saves.

Verified headlessly: loading save 300, which was made before the fix, no
longer prints the alert.

## 2. "You simply can't enter" erases the map's bottom row

### Symptom

Choose Move and pick a location you can't enter yet, for example
`54 - Inchling's Insect Cage`. The message "You simply can't enter." appears.
After clicking past it, the map is still active, but its last row is gone:
`[ 58] - Return　＜]Change Map (1)[＞　[C] - Change Display Mode`.

### Cause

- The map menu (`COMF400 移動.ERB`) ends with
  `PRINTBUTTON "[C] - Change Display Mode　　 ", "C"` and no newline, then
  waits in `INPUTS`.
- In Emuera, input is echoed with `Print(str); PrintFlush(false)`
  (`EmueraConsole.doInputToEmueraProgram`). The echo is appended to the
  unfinished line, so the last row becomes `…[C] - Change Display Mode　　 54`.
- `CANNOT_MOVE_MESSAGE` and every map's `MAP_CANNOT_WORD_*` then do
  `PRINTFORMW <message>`, `CLEARLINE 2` and `REUSELASTLINE`. The intent is to
  remove "the echoed input and the message". Because the echo shares the menu
  row, `CLEARLINE 2` deletes the message **and the menu's last row**. The loop
  then goes back to the same `INPUT` without redrawing the map.

The same happens for "It's locked.", "Invalid input", the Lunatic Survival
restriction messages, and the "too inexperienced" message.

### Fix

Add a `PRINTL` after the menu is drawn and before the input loop. This ends
the last row, so the echo goes on its own line and `CLEARLINE 2` removes
exactly the echo and the message. The shared `CANNOT_MOVE_MESSAGE` and the
per-map message functions stay unchanged.

The menu looks the same, because `PRINTL` on a non-empty pending line only
finishes that line. The map-animation redraw (`CLEARLINE LINECOUNT - LINESTART`)
still clears the whole menu, because the finished row is now counted inside
that range.

Verified headlessly: after Move then `54`, the output is
`…[C] - Change Display Mode`, `54`, `You simply can't enter.`, `<<clear 2>>`,
and the menu row survives.

## Patch

Apply from inside `anon-tw-anon-tw_eng-modding` with `git apply -p1` or
`patch -p1`. The files are UTF-8 with LF line endings. `Chara153 美天.csv`
starts with a BOM, which the patch leaves untouched.

```diff
diff -ru a/CSV/Chara/Chara153 美天.csv b/CSV/Chara/Chara153 美天.csv
--- a/CSV/Chara/Chara153 美天.csv
+++ b/CSV/Chara/Chara153 美天.csv
@@ -72,5 +72,5 @@
 CSTR,仕事情報,
 CSTR,職場,
 
-相性,153,120;ウバメ
+相性,159,120;ウバメ
 CSTR,10,～小さな聖域の大聖～　●種族：猿神　●能力：野生の猿を操る程度の能力
diff -ru a/ERB/TRANSLATION/Addition/Add_Relation.ERB b/ERB/TRANSLATION/Addition/Add_Relation.ERB
--- a/ERB/TRANSLATION/Addition/Add_Relation.ERB
+++ b/ERB/TRANSLATION/Addition/Add_Relation.ERB
@@ -1342,6 +1342,14 @@
 
 ;bug squashing
 @EVENTLOAD
+;Patch: saves made before the Chara153 CSV fix stored Biten's Ubame affinity at her own number (153) instead of Ubame's (159)
+FOR LOCAL, 0, CHARANUM
+	IF NO:LOCAL == 153 && RELATION:LOCAL:153 == 120
+		SIF !RELATION:LOCAL:159
+			RELATION:LOCAL:159 = 120
+		RELATION:LOCAL:153 = 0
+	ENDIF
+NEXT
 LOCAL:2 = 0
 FOR LOCAL, 0, CHARANUM
 	FOR LOCAL:1, 0, CHARANUM
diff -ru a/ERB/コマンド関連/COMF/日常系/COMF400 移動.ERB b/ERB/コマンド関連/COMF/日常系/COMF400 移動.ERB
--- a/ERB/コマンド関連/COMF/日常系/COMF400 移動.ERB
+++ b/ERB/コマンド関連/COMF/日常系/COMF400 移動.ERB
@@ -129,6 +129,8 @@
 		PRINT (It's hard to walk alone in this state...)
 	ENDIF
 ENDIF
+;Patch: end the last menu row so the INPUT echo gets its own line for CLEARLINE 2
+PRINTL
 
 DO
 	;Map Animation Code
```
