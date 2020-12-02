"use strict";

const Fs = require("fs").promises;
const Path = require("path");

exports.locateGlobalNodeModules = async () => {
  //
  const nodeBinDir = Path.dirname(process.argv[0]);
  const nm = "node_modules";

  // 1. check ./node_modules (windows)
  // 2. check ../node_modules
  // 3. check ../lib/node_modules (unix)

  const checks = ["", "..", ["..", "lib"]];

  for (const chk of checks) {
    const dir = Path.join(...[nodeBinDir].concat(chk, nm));
    try {
      const stat = await Fs.stat(dir);
      if (stat.isDirectory()) {
        return dir;
      }
    } catch (e) {
      //
    }
  }

  return "";
};

exports.locateGlobalFyn = async (globalNmDir = null) => {
  globalNmDir = globalNmDir || (await exports.locateGlobalNodeModules());

  if (!globalNmDir) {
    logger.error("Unable to locate your global node_modules from", process.argv[0]);
    return "";
  }

  try {
    const dir = Path.join(globalNmDir, "fyn");
    const pkgJson = require(Path.join(dir, "package.json"));
    return {
      dir,
      pkgJson
    };
  } catch (e) {
    return {};
  }
};
