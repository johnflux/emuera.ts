import { emptyGame, indexScript, type Game } from "./loader.js";

// Original conformance program, not a replacement implementation of the bundled game.
const source = `
@SYSTEM_TITLE
#DIM I
SETCOLOR 100, 220, 255
PRINTL Emuera.ts - ERB interpreter conformance demo
RESETCOLOR
DRAWLINE
PRINTL This demo executes ERB. The bundled game is a separate run.
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
  CASE 0
    PRINTL Demo finished. Start another run using the toolbar.
    RETURN
  CASEELSE
    PRINTL Choose 0, 1, 2, 3, 4 or 5.
ENDSELECT
GOTO MENU

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
#DIM TARGET
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
export function demoGame(game: Game): Game {
  const demo = emptyGame(game.root);
  demo.sprites = game.sprites;
  // The client lays out pictures with the game's font and line height, so the demo reads the same config.
  demo.config = game.config;
  indexScript(demo, source, "<foundation-demo>");
  return demo;
}
