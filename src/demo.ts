import { emptyGame, indexScript, type Game } from "./loader.js";

// Original conformance program, not a replacement implementation of the bundled game.
const source = `
@SYSTEM_TITLE
#DIM I
SETCOLOR 100, 220, 255
PRINTL TypeScript Emuera - interpreter foundation
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
  CASE 0
    PRINTL Demo finished. Start another run using the toolbar.
    RETURN
  CASEELSE
    PRINTL Choose 0, 1, 2 or 3.
ENDSELECT
GOTO MENU

@CALCULATE(ARG:0, ARG:1)
RETURN ARG:0 * ARG:1
`;
export function demoGame(game: Game): Game {
  const demo = emptyGame(game.root);
  demo.sprites = game.sprites;
  indexScript(demo, source, "<foundation-demo>");
  return demo;
}
