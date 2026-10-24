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
  CASE 0
    PRINTL Demo finished. Start another run using the toolbar.
    RETURN
  CASEELSE
    PRINTL Choose 0, 1, 2, 3 or 4.
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

@CALCULATE(ARG:0, ARG:1)
RETURN ARG:0 * ARG:1
`;
export function demoGame(game: Game): Game {
  const demo = emptyGame(game.root);
  demo.sprites = game.sprites;
  indexScript(demo, source, "<foundation-demo>");
  return demo;
}
