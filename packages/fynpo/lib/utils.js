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

function _searchForFynpo(cwd = process.cwd()) {
  let dir = cwd;
  let prevDir = dir;
  let config;
  let lerna;
  let lernaDir;
  let count = 0;

  do {
    try {
      config = JSON.parse(Fs.readFileSync(Path.join(dir, "fynpo.json")));
      break;
    } catch (e) {}

    try {
      lerna = JSON.parse(Fs.readFileSync(Path.join(dir, "lerna.json")));
      lernaDir = dir;
      if (lerna.fynpo) {
        config = lerna;
        break;
      }
    } catch (e) {}

    prevDir = dir;
    dir = Path.dirname(dir);
  } while (++count < 50 && dir !== prevDir);

  return { config, dir, lerna, lernaDir };
}

exports.loadConfig = (cwd = process.cwd()) => {
  let fynpoRc = {};
  let dir = cwd;

  const data = _searchForFynpo(cwd);

  if (!data.config) {
    if (data.lerna) {
      logger.info("found lerna.json at", data.lernaDir, "adding fynpo signature");
      fynpoRc = { ...data.lerna, fynpo: true };
      Fs.writeFileSync(Path.join(data.lernaDir, "lerna.json"), JSON.stringify(fynpoRc) + "\n");
    } else {
      logger.info("creating fynpo.json at", cwd);
      Fs.writeFileSync(Path.join(cwd, "fynpo.json"), "{}\n");
      dir = cwd;
    }
  } else {
    fynpoRc = data.config;
    dir = data.dir;
  }

  return { fynpoRc, dir };
};
