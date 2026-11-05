const { createRequire } = require("node:module");
const path = require("node:path");
const { Arch } = require("electron-builder");

module.exports = async function beforePack(context) {
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  if (platform !== process.platform || arch !== process.arch) {
    throw new Error(
      `Cannot package ${platform}/${arch} using dependencies installed on ${process.platform}/${process.arch}. ` +
      "Build on the target operating system and architecture with npm ci, or use the GitHub release workflow.",
    );
  }

  const appRequire = createRequire(path.join(context.packager.info.appDir, "package.json"));
  appRequire("@napi-rs/canvas");
  appRequire("@napi-rs/image");
};
