# Game patches

Emuera.ts runs `GAMES/anon-tw-anon-tw_eng-modding` (eraToho The World) as-is and implements Emuera's
behaviour faithfully, including when the game itself is wrong. The fixes below
are for **bugs in the game's own data and scripts**. Each one was checked
against EvilMask's Emuera (EM) source, so the same symptom appears in the real
`Emuera.exe`. Nothing in the interpreter was changed for them.

The game folder is git-ignored, so the patch is reproduced in full at the end
of this document. Re-apply it after updating or reinstalling the game.

| # | Symptom | Cause | Files |
|---|---------|-------|-------|
| 1 | "Ego alert! Biten has Relation towards herself!" on every load | Typo in Biten's CSV: her affinity for Ubame uses Biten's number | `CSV/Chara/Chara153 美天.csv`, `ERB/TRANSLATION/Addition/Add_Relation.ERB` |
| 2 | Play A Game: after picking a game, "Add a wager?" answers every choice with "Invalid input" and never lets you continue | Off-by-one in the bet-choice check (`RESULT < LOCAL-1`) | `ERB/TRANSLATION/Addition/Custom_Commands/Add_CUSTOM_COM0 Play Game.ERB` |
| 3 | Pilfer Panties [821] and Take Panties [825] silently do nothing after starting mischief while time is frozen | Their handlers reject the session flag that frozen-time mischief sets, although the menu still offers both actions | `ERB/コマンド関連/USERCOM.ERB` |
| 4 | A character with hate marks is as willing to kiss, have sex or become lovers as one without | Sign slip in the consent value: `MIN` instead of `MAX`, so the hate-mark penalty is never applied | `ERB/ステータス計算関連/ATTITUDE.ERB` |
| 5 | After a hate mark (for example from a refused Push Down) the character is "angry..." at full anger, yet Apologize [303] is not offered | Anger decay clears the furious flag while anger is still 0, one step before the sulk refills anger to max, and nothing sets the flag again | `ERB/MOVEMENTS/BASE自然変動.ERB` |

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

## 2. "Add a wager?" rejects every choice

### Symptom

Choose Play A Game `[9000]` and pick a game, for example `[1] - Shogi`. The game
asks "Add a wager?" and lists `[0] - No wager`. Entering `0` prints
"Invalid input", and so does every other number. The prompt never ends.

### Cause

- `@ADD_CUSTOM_COM0` lists the bets with `FOR LOCAL, 0, 20`, which `BREAK`s at
  the first empty entry. The bet strings end in `/` (`ADD_GAME_STANDARD_BETS`
  returns `NONE/`, plus `MONEY/` and `CHARISMA/` when you can afford them), so
  `SPLIT` leaves an empty entry right after the last bet. `LOCAL` therefore ends
  up equal to the number of bets shown.
- The input loop accepts `RESULT >= 0 && RESULT < LOCAL-1`. That is one too few.
  With only "No wager" it accepts nothing, and `DO … LOOP 1` asks again forever.
  With more bets, the last one listed can never be chosen.

### Fix

Accept `RESULT < LOCAL`, so every listed bet, and only those, can be chosen.

## 3. Pilfer commands stop working during frozen-time mischief

`@COM350` ("Start Mischief", including "With All") sets `CFLAG:target:うふふ`,
the same session flag used during ordinary sessions. The frozen-time command menu
continues to offer Pilfer Panties [821] and Take Panties [825], but `@USERCOM`
requires `!CFLAG:うふふ` for both. The result is a silent no-op, not a command-number
collision with Push Down [350].

Allow the session flag when `FLAG:70` (time stopped) is set. Keep all other
eligibility checks and continue rejecting these actions during ordinary sessions.
Regression coverage in `test/hotpatch.test.ts` exercises both handlers with and
without frozen-time sessions.

## 4. Hate marks never lower consent

`@CHARA_ATTITUDE` computes each character's consent value (`CFLAG:合意判定`),
which Kiss, Push Down and Confess compare with their thresholds. Its mark
adjustment is

```
LOCAL:1 -= MIN(MARK:LOCAL:反発刻印 - MARK:LOCAL:時姦刻印 , 0) * 30
```

The intent is −30 per hate mark (反発刻印) not offset by timestop marks
(時姦刻印). With `MIN(…, 0)` the subtracted term is never positive: hate marks
have no effect, and only timestop marks in excess of hate marks change the
value, *raising* it. `MAX(…, 0)` gives the intended penalty and never raises the
value. Timestop marks already lower the push-down threshold separately in
`@抱き寄せ`.

## 5. A sulking character cannot be apologised to

Gaining a hate mark (`@TRACHECK_刻印取得`) sets `CFLAG:不機嫌` (sulking, the
"X is angry..." line) and `CFLAG:ブチギレ` (furious), but leaves `BASE:怒り`
(anger) where it was, often 0. The favor process that would max it out for a
sulking character has already run in that step. The next time time passes,
`@BASE自然変動` runs:

1. anger decays, and `SIF BASE:ARG:怒り <= 0` clears `ブチギレ`;
2. then `SIF CFLAG:ARG:不機嫌` sets anger to max, but not `ブチギレ`.

The character is now sulking at full anger, but not furious. `@COM_ABLE303`
requires `ブチギレ` (or a gift box with a first hate mark), so Apologize is
not offered. Elsewhere the game treats sulking as always furious: the favor
process sets both together, and a successful Apologize clears both together.
The fix sets `ブチギレ` alongside the anger in the sulk block.

## Patch

Apply from inside `GAMES/anon-tw-anon-tw_eng-modding` with `git apply -p1` or
`patch -p1`. The files are UTF-8 with LF line endings. `Chara153 美天.csv`
starts with a BOM, which the patch leaves untouched.

For the hate-mark fix:

```diff
--- a/ERB/ステータス計算関連/ATTITUDE.ERB
+++ b/ERB/ステータス計算関連/ATTITUDE.ERB
@@ -48,7 +48,7 @@
 	LOCAL:1 += BASE:LOCAL:ムード / 25 + (1000 - BASE:LOCAL:理性) / 25
 	;刻印による修正
 	LOCAL:1 += MARK:LOCAL:不埒刻印 * 20 + MARK:LOCAL:快楽刻印 * 20
-	LOCAL:1 -= MIN(MARK:LOCAL:反発刻印 - MARK:LOCAL:時姦刻印 , 0) * 30
+	LOCAL:1 -= MAX(MARK:LOCAL:反発刻印 - MARK:LOCAL:時姦刻印 , 0) * 30 ;Patch: was MIN, which is never positive, so hate marks never lowered consent
 	;お薬
 	IF TCVAR:LOCAL:発情
 		LOCAL:1 += 50
```

For the sulking fix:

```diff
--- a/ERB/MOVEMENTS/BASE自然変動.ERB
+++ b/ERB/MOVEMENTS/BASE自然変動.ERB
@@ -109,8 +109,10 @@
 CALL Add_VigRecovery(ARG) ;addition custom code
 
 ;不機嫌
-SIF CFLAG:ARG:不機嫌
+IF CFLAG:ARG:不機嫌
 	BASE:ARG:怒り = MAXBASE:ARG:怒り
+	CFLAG:ARG:ブチギレ = 1 ;Patch: anger decay above clears this while a freshly gained hate mark still has 怒り at 0, leaving a sulking character who cannot be apologised to
+ENDIF
 
 ;勃起度の自然増減
 IF CFLAG:ARG:うふふ
```

For the pilfer-command fix, apply this additional patch:

```diff
--- a/ERB/コマンド関連/USERCOM.ERB
+++ b/ERB/コマンド関連/USERCOM.ERB
@@ -171,2 +171,3 @@
 ELSEIF RESULT == 821 && EQUIP:0 && EQUIP:TARGET:下半身下着２
-	SIF TARGET && CFLAG:TARGET:291 == 0 && (FLAG:70 || CFLAG:イタズラ || UNDRESS_DEBUG) && !CFLAG:うふふ ;custom code
+	;Frozen-time mischief also sets the session flag; it must not block a displayed pilfer command.
+	SIF TARGET && CFLAG:TARGET:291 == 0 && (FLAG:70 || CFLAG:イタズラ || UNDRESS_DEBUG) && (FLAG:70 || !CFLAG:うふふ) ;custom code
@@ -209,2 +210,2 @@
 ELSEIF RESULT == 825 && TFLAG:パンツ収奪
-	IF TARGET && (FLAG:70 || CFLAG:イタズラ || UNDRESS_DEBUG) && !CFLAG:うふふ ;custom code
+	IF TARGET && (FLAG:70 || CFLAG:イタズラ || UNDRESS_DEBUG) && (FLAG:70 || !CFLAG:うふふ) ;custom code
```

The earlier fixes:

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
diff -ru a/ERB/TRANSLATION/Addition/Custom_Commands/Add_CUSTOM_COM0 Play Game.ERB b/ERB/TRANSLATION/Addition/Custom_Commands/Add_CUSTOM_COM0 Play Game.ERB
--- a/ERB/TRANSLATION/Addition/Custom_Commands/Add_CUSTOM_COM0 Play Game.ERB
+++ b/ERB/TRANSLATION/Addition/Custom_Commands/Add_CUSTOM_COM0 Play Game.ERB
@@ -130,7 +130,7 @@
 	NEXT
 	DO
 		INPUT
-		SIF RESULT >= 0 && RESULT < LOCAL-1
+		SIF RESULT >= 0 && RESULT < LOCAL ;Patch: LOCAL is already the number of bets listed (was LOCAL-1, so a lone "No wager" could never be chosen)
 			BREAK
 		REUSELASTLINE Invalid input
 		CONTINUE
```
