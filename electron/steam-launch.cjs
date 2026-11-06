module.exports = function isSteamLaunch(env = process.env) {
  return [env.SteamGameId, env.SteamAppId].some(
    (id) => typeof id === "string" && /^\d+$/.test(id) && /[1-9]/.test(id),
  );
};
