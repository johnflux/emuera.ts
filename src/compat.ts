import { loadGame } from "./loader.js";
import { compatibility } from "./compatibility.js";

try {
  console.log(JSON.stringify(compatibility(await loadGame()), null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
