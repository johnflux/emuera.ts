import { indexScript, type Game } from "./loader.js";

// Original conformance program, not a replacement implementation of the bundled game.
const source = `
@SYSTEM_TITLE
#DIM I
SETCOLOR 100, 220, 255
PRINTL Emuera.ts - ERB interpreter conformance demo
RESETCOLOR
DRAWLINE
PRINTL This demo executes ERB. Item 8 opens the bundled game's main screen in prepared situations.
HTML_PRINT "<p align='center'><b>HTML, sprite crops and clickable choices</b></p>"
HTML_PRINT "<p align='center'><img src='TW_title000'></p>"
HTML_PRINT "<a href='https://wiki.eragames.rip/index.php/Emuera'>Language reference</a>"
FOR I, 0, 3
  PRINTFORML Loop iteration: {I}
NEXT
$MENU
PRINTL
PRINTBUTTON " [1] Integer arithmetic ", 1
PRINTBUTTON " [2] Enter text ", 2
PRINTBUTTON " [3] Single-character input (no Enter) ", 3
PRINTBUTTON " [4] Animated sprites ", 4
PRINTBUTTON " [5] Character portraits ", 5
PRINTBUTTON " [6] Dialogue (click to continue) ", 6
PRINTBUTTON " [7] Command grid (PRINTC) ", 7
PRINTBUTTON " [8] Main screen scenarios ", 8
HTML_PRINT "<button value='0' title='End this demo'>[0] Quit</button>"
INPUT
SELECTCASE RESULT
  CASE 1
    CALL CALCULATE(7, 6)
    PRINTFORML Result from CALL: {RESULT}
  CASE 2
    PRINTL Enter a name:
    INPUTS
    PRINTFORML Hello, %RESULTS%.
  CASE 3
    PRINTL ONEINPUT: type one digit; it submits immediately without Enter.
    ONEINPUT
    PRINTFORML Received digit: {RESULT}
    PRINTL ONEINPUTS: type one character; it also submits without Enter.
    ONEINPUTS
    PRINTFORML Received character: %RESULTS%
  CASE 4
    CALL ANIMATIONS
  CASE 5
    CALL PORTRAITS
  CASE 6
    ; Lines finished by a click-to-continue wait stay bright until the next menu.
    PRINTW Hello!
    PRINTW How are you doing?
    PRINTL Back to the menu.
  CASE 7
    ; Fixed-width PRINTC items wrap between items, never inside one (ボタンの途中で行を折りかえさない).
    PRINTL A row of PRINTC commands, as the game's command menu prints them:
    SETCOLOR 0x00FF00
    PRINTC Move[400]
    RESETCOLOR
    PRINTC Go Out[405]
    PRINTC Dirtiness[801]
    PRINTC Abilities[803]
    PRINTC Abilities (Master)[804]
    PRINTC Item List[805]
    PRINTC Lock The Door[991]
    PRINTC Calendar[993]
    PRINTC Auto-TSP Movement[995]
    PRINTC Auto-Clean[996]
    PRINTL
    INPUT
    PRINTFORML Command {RESULT} chosen.
  CASE 8
    CALL SCENARIOS
    ; BEGIN returns only from SCENARIOS; the new state starts once the title program returns.
    SIF DEMO_SCENARIO
      RETURN
  CASE 0
    PRINTL Demo finished. Start another run using the toolbar.
    RETURN
  CASEELSE
    PRINTL Choose a number from 0 to 8.
ENDSELECT
GOTO MENU

@SCENARIOS
#DIMS SCENE, 12 = "", "Alone", "One person", "Two people", "Crowd (six people)", "Time stopped, two people", "Time stopped, alone", "Partner asleep", "Exhausted", "Outdoors at night, in the rain", "Asleep, before waking (the sleep menu)", "Crowd stress test (24 people)"
#DIM I
; RESETDATA resets static locals too.
#DIM DYNAMIC CHOICE
PRINTL Start the bundled game on its main screen in a prepared situation (Quicktest player, Hakurei Shrine back room).
PRINTL Play continues normally from there; restart the demo to pick another scenario.
FOR I, 1, 12
  PRINTFORML [{I}] %SCENE:I%
NEXT
PRINTL [0] Back
INPUT
IF RESULT < 1 || RESULT > 11
  RETURN 0
ENDIF
CHOICE = RESULT
; The game's own Quicktest (TITLE.ERB option 99) without its option prompts.
RESETDATA
CALL MAKE_TALENT_MAP
DEMO_SCENARIO = CHOICE
DevTest = 1
VARSET DevTestOptions
DevTestOptions:10 = -1
CALL Name_Array_Set
CALL ADDCHARA_INIT(0)
; A home lets NEWGAME skip the home picker; the back room is where a new player starts.
CFLAG:0:自宅位置 = 40
CFLAG:0:初期位置 = 53
BEGIN FIRST

@EVENTFIRST
#LATER
; Overrides SYSTEM.ERB's BEGIN SHOP so the day starts at once (like choosing [100]); scenario 10 stays on the sleep menu.
IF DEMO_SCENARIO == 10
  DEMO_SCENARIO = 0
  DevTest = 0
ELSEIF DEMO_SCENARIO
  BEGIN TRAIN
ENDIF

; Wraps the game's main screen: the scene is arranged right before it is first drawn, so arrival greetings wait for the next turn.
@SHOW_STATUS
SIF DEMO_SCENARIO
  CALL ARRANGE_SCENE
CALL GAME_SHOW_STATUS

@ARRANGE_SCENE
#DIM CHARA, 6 = 1, 11, 120, 57, 10, 21
#DIM COUNT
#DIM C
#DIM N
#DIM ROOM
DevTest = 0
SELECTCASE DEMO_SCENARIO
  CASE 2, 7, 8, 9
    COUNT = 1
  CASE 3, 5
    COUNT = 2
  CASE 4
    COUNT = 6
  CASE 11
    COUNT = MIN(24, CHARANUM - 1)
ENDSELECT
ROOM = CFLAG:MASTER:現在位置
IF DEMO_SCENARIO == 9
  ; The first open-air place at home, late in the evening, raining.
  FOR C, 1, 100
    IF IN_HOME(C) == 1 && OUTROOF(C) && STRLENS(STR:(8000 + C))
      ROOM = C
      BREAK
    ENDIF
  NEXT
  CFLAG:MASTER:現在位置 = ROOM
  CFLAG:MASTER:前ターン位置 = ROOM
  TIME = 22 * 60
  TIME:5 = 4
ENDIF
FOR C, 1, CHARANUM
  SIF CFLAG:C:現在位置 == ROOM
    CFLAG:C:現在位置 = ENTRANCE
NEXT
; Already met, greeted and present last turn, so no arrival or first-meeting events interrupt the screen.
FOR C, 0, COUNT
  IF DEMO_SCENARIO == 11
    N = C + 1
  ELSE
    N = GETCHARA(CHARA:C)
  ENDIF
  CFLAG:N:現在位置 = ROOM
  CFLAG:N:前ターン位置 = CFLAG:MASTER:前ターン位置
  CFLAG:N:面識 = 1
  TCVAR:N:今日会ったか = 1
  TCVAR:N:GREETED_NOW = 1
  CFLAG:N:同室 = 1
  CALL SET_SLEEP(0, N, 0)
NEXT
CALL SET_SLEEP(0, MASTER, 0)
SIF COUNT
  TARGET = GETCHARA(CHARA)
; Start at the far end of the crowd to exercise selected-person scrolling.
SIF DEMO_SCENARIO == 11
  TARGET = COUNT
SELECTCASE DEMO_SCENARIO
  CASE 5, 6
    CALL COM355
  CASE 7
    CFLAG:TARGET:睡眠 = 1
  CASE 8
    BASE:MASTER:体力 = MAXBASE:MASTER:体力 / 10
    BASE:MASTER:気力 = MAXBASE:MASTER:気力 / 8
    BASE:TARGET:体力 = MAXBASE:TARGET:体力 / 6
    BASE:TARGET:気力 = MAXBASE:TARGET:気力 / 12
ENDSELECT
DEMO_SCENARIO = 0

@ANIMATIONS
#DIM FRAME
#DIM DOT
PRINTL SPRITEANIMECREATE + SPRITEANIMEADDFRAME (4 frames):
IF !SPRITECREATED("DEMO_LIGHTS")
  SPRITEANIMECREATE "DEMO_LIGHTS", 80, 20
  FOR FRAME, 0, 4
    GCREATE 900 + FRAME, 80, 20
    GCLEAR 900 + FRAME, 0xFF202020
    FOR DOT, 0, 4
      GSETBRUSH 900 + FRAME, DOT == FRAME ? 0xFFFFD040 # 0xFF404040
      GFILLRECTANGLE 900 + FRAME, DOT * 20 + 4, 4, 12, 12
    NEXT
    SPRITEANIMEADDFRAME "DEMO_LIGHTS", 900 + FRAME, 0, 0, 80, 20, 0, 0, FRAME == 0 ? 600 # 200
  NEXT
ENDIF
; Images draw over the lines below them, so reserve their height (2 lines) as Emuera scripts do.
HTML_PRINT "<img src='DEMO_LIGHTS' height='200'>"
PRINTL
PRINTL
IF SPRITECREATED("30_BG1")
  PRINTL resources CSV ANIME sprite 30_BG1 (2 frames):
  HTML_PRINT "<img src='30_BG1' height='600'>"
  REPEAT 5
    PRINTL
  REND
ELSE
  PRINTL The game's CSV animation 30_BG1 is not installed.
ENDIF

; Character portraits in the game's style: parts from resources/highresChara/*.csv are composited
; into one sprite (GCREATE + GDRAWSPRITE + SPRITECREATE), then printed as HTML picture buttons.
@PORTRAITS
#DIM CHARA, 3 = 120, 21, 57
#DIMS NAME, 3 = "Aunn", "Merlin", "Kokoro"
#DIMS FACE, 4 = "通常", "笑い", "怒り", "驚き"
#DIMS FACE_LABEL, 4 = "Normal", "Smile", "Angry", "Surprised"
#DIM EXPRESSION
#DIM BLUSH
#DIM LAYERED
#DIM CLOSEUP
#DIMS VIEW
#DIM SIZE = 180
#DIM I
#DIM PAD
#DIM LINE_HEIGHT
#DIM LINES
#DIM START
#DIMS ROW
#DIMS STAND
#DIMS HOVER
IF !SPRITECREATED("highres_120_本体_通常")
  PRINTL The game's highres character sprites are not installed.
  RETURN
ENDIF
LINE_HEIGHT = GETCONFIG("一行の高さ")
; The selection is the global TARGET, as in the game, so the client can mark the selected picture
TARGET = 0
; Redraw in place: erase everything printed since the page began, as the game's own menus do
START = LINECOUNT
$REDRAW
SIF LINECOUNT > START
  CLEARLINE LINECOUNT - START
VIEW '= CLOSEUP ? "顔絵" # "立ち絵"
DRAWLINE
PRINTFORML Target: %NAME:TARGET%  Expression: %FACE_LABEL:EXPRESSION%  Blush: %BLUSH ? "on" # "off"%  Size: {SIZE}px  Mode: %LAYERED ? "layered" # "composited"%  Picture: %CLOSEUP ? "face" # "standing"%
; Name row, centered over each picture (the current target in aqua, as the game shows it)
ROW = <p align='center'><nobr>
FOR I, 0, 3
  PAD = (SIZE - HTML_STRINGLEN("[" + NAME:I + "]", 1)) / 2
  ROW += @"<shape type='space' param='{PAD}px'><font color='%I == TARGET ? "#66ffff" # "#ffc864"%'><button value='{1000 + I}' title='Target: {I + 1}'>[%NAME:I%]</button></font><shape type='space' param='{PAD}px'>"
NEXT
HTML_PRINT ROW + "</nobr></p>"
; Base layer: body + expression (+ blush when composited); hovering shows the smiling variant (srcb).
; Clicking the current target's picture toggles face close-ups, as the game's USERCOM does.
ROW = <p align='center'><nobr>
FOR I, 0, 3
  STAND = %PORTRAIT_SPRITE(CHARA:I, FACE:EXPRESSION, BLUSH && !LAYERED, VIEW)%
  HOVER = %PORTRAIT_SPRITE(CHARA:I, "笑い", BLUSH && !LAYERED, VIEW)%
  ROW += @"<button value='{1000 + I}' title='%NAME:I%'><img src='%STAND%' srcb='%HOVER%' width='{SIZE}px' height='{SIZE}px'></button>"
NEXT
HTML_PRINT ROW + "</nobr></p>"
LINES = 1
; Layered mode: the blush is a separate picture on the next line, pulled up by one line height with ypos
IF BLUSH && LAYERED
  ROW = <p align='center'><nobr>
  FOR I, 0, 3
    STAND = %PORTRAIT_SPRITE(CHARA:I, "", 1, VIEW)%
    ROW += @"<button value='{1000 + I}' title='%NAME:I%'><img src='%STAND%' width='{SIZE}px' height='{SIZE}px' ypos='-{LINE_HEIGHT}px'></button>"
  NEXT
  HTML_PRINT ROW + "</nobr></p>"
  LINES = 2
ENDIF
; Reserve the picture height below the first line, as the game's ピクセル自動改行 does
REPEAT (SIZE + LINE_HEIGHT - 1) / LINE_HEIGHT - LINES
  PRINTL
REND
FOR I, 0, 4
  PRINTBUTTON @"[{10 + I}] %FACE_LABEL:I% ", 10 + I
NEXT
PRINTL
PRINTBUTTON @"[20] Blush %BLUSH ? "off" # "on"% ", 20
PRINTBUTTON @"[21] Size %SIZE == 180 ? "300" # "180"%px ", 21
PRINTBUTTON @"[22] %LAYERED ? "Composited" # "Layered"% ", 22
PRINTBUTTON "[99] Back ", 99
INPUT
IF RESULT >= 1000 && RESULT < 1003
  SIF RESULT - 1000 == TARGET
    CLOSEUP = !CLOSEUP
  TARGET = RESULT - 1000
ELSEIF RESULT >= 10 && RESULT < 14
  EXPRESSION = RESULT - 10
ELSEIF RESULT == 20
  BLUSH = !BLUSH
ELSEIF RESULT == 21
  SIZE = SIZE == 180 ? 300 # 180
ELSEIF RESULT == 22
  LAYERED = !LAYERED
ELSEIF RESULT == 99
  RETURN
ENDIF
GOTO REDRAW

; Composite a character's picture: body, then an expression and/or the blush effect, cropped to the
; VIEW frame (立ち絵 standing or 顔絵 face close-up). An empty FACE leaves out the body and expression.
@PORTRAIT_SPRITE(ID, FACE, BLUSH, VIEW)
#FUNCTIONS
#DIM ID
#DIMS FACE
#DIM BLUSH
#DIMS VIEW
#DIMS FRAME
#DIMS OUT
#DIMS PART
#DIM GID
OUT '= @"DEMO_%VIEW%_{ID}_%FACE%_{BLUSH}"
SIF SPRITECREATED(OUT)
  RETURNF OUT
FRAME '= @"highres_{ID}_%VIEW%_%VIEW%"
GID = 900
WHILE GCREATED(GID)
  GID ++
WEND
GCREATE GID, SPRITEPOSX(FRAME) + SPRITEWIDTH(FRAME), SPRITEPOSY(FRAME) + SPRITEHEIGHT(FRAME)
IF FACE != ""
  PART '= @"highres_{ID}_本体_通常"
  GDRAWSPRITE GID, PART, 0, 0, SPRITEWIDTH(PART), SPRITEHEIGHT(PART)
  PART '= @"highres_{ID}_表情_%FACE%"
  GDRAWSPRITE GID, PART, 0, 0, SPRITEWIDTH(PART), SPRITEHEIGHT(PART)
ENDIF
IF BLUSH
  PART '= @"highres_{ID}_効果_赤面"
  GDRAWSPRITE GID, PART, 0, 0, SPRITEWIDTH(PART), SPRITEHEIGHT(PART)
ENDIF
SPRITECREATE OUT, GID, SPRITEPOSX(FRAME), SPRITEPOSY(FRAME), SPRITEWIDTH(FRAME), SPRITEHEIGHT(FRAME)
RETURNF OUT

@CALCULATE(ARG:0, ARG:1)
RETURN ARG:0 * ARG:1
`;
// Stand-ins for the debug item grants that the game's Quicktest always runs (an SIF there guards only the first CALL); one opens an item menu.
const quicktestItemGrants = ["100", "101", "102", "103", "104", "105", "106", "107", "108", "110", "200", "201", "202", "203"].map((n) => `DEBUG_MENU_RESULT_2_${n}`);
const header = "#DIM DEMO_SCENARIO\n";
/** The demo overlays the (hotpatched) game: its own title program replaces SYSTEM_TITLE, and the scenarios start the game's real main screen. */
export function demoGame(game: Game): Game {
  const demo: Game = { ...game, routines: new Map(game.routines), headers: [...game.headers], diagnostics: [] };
  for (const name of ["SYSTEM_TITLE", ...quicktestItemGrants]) demo.routines.delete(name);
  // Event handler lists are appended to, so copy the one the demo extends.
  demo.routines.set("EVENTFIRST", [...(demo.routines.get("EVENTFIRST") ?? [])]);
  demo.routines.set("GAME_SHOW_STATUS", (demo.routines.get("SHOW_STATUS") ?? []).map((routine) => ({ ...routine, name: "GAME_SHOW_STATUS", label: "GAME_SHOW_STATUS" })));
  demo.routines.delete("SHOW_STATUS");
  indexScript(demo, header, "<foundation-demo>.ERH", true);
  indexScript(demo, source + quicktestItemGrants.map((name) => `\n@${name}\n`).join(""), "<foundation-demo>");
  return demo;
}
