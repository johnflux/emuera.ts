const path = require("node:path");

module.exports = function gamePaths(userData, executable, platform = process.platform) {
  const appData = path.join(userData, "GAMES");
  const adjacent = path.join(path.dirname(executable), "GAMES");
  return platform === "win32"
    ? { installDirectory: adjacent, searchDirectories: [adjacent, appData] }
    : { installDirectory: appData, searchDirectories: [appData, adjacent] };
};
