"use strict";

const Fs = require("fs");
const pFs = Fs.promises;
const Path = require("path");
const logger = require("./logger");

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
      const stat = await pFs.stat(dir);
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

exports.loadConfig = (cwd = process.cwd()) => {
  let dir = cwd;
  let prevDir = dir;
  let fynpoRc;
  let lernaRc;
  let count = 0;

  do {
    try {
      fynpoRc = JSON.parse(Fs.readFileSync(Path.join(dir, "fynpo.json")));
      break;
    } catch (e) {}

    try {
      lernaRc = JSON.parse(Fs.readFileSync(Path.join(dir, "lerna.json")));
      if (lernaRc) {
        fynpoRc = lernaRc.fynpo;
        break;
      }
    } catch (e) {}

    prevDir = dir;
    dir = Path.dirname(dir);
  } while (++count < 50 && dir !== prevDir);

  if (!fynpoRc) {
    if (lernaRc) {
      logger.info("found lerna.json at", dir, "adding fynpo section");
      Fs.writeFileSync(
        Path.join(dir, "lerna.json"),
        JSON.stringify({
          ...lernaRc,
          fynpo: {}
        }) + "\n"
      );
    } else {
      lernaRc = {};
      logger.info("creating fynpo.json at", cwd);
      Fs.writeFileSync(Path.join(cwd, "fynpo.json"), "{}\n");
      dir = cwd;
    }

    fynpoRc = {};
  }

  return { lernaRc, fynpoRc, dir };
};
