const path = require("node:path");

module.exports = function gamePaths(userData, executable, portableDirectory) {
  const appData = path.join(userData, "GAMES");
  const adjacent = path.join(portableDirectory || path.dirname(executable), "GAMES");
  return portableDirectory
    ? { installDirectory: adjacent, searchDirectories: [adjacent, appData] }
    : { installDirectory: appData, searchDirectories: [appData, adjacent] };
};
