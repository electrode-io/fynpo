"use strict";

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const logger = require("./logger");

function readPackages(dir) {
  const pkgPath = Path.join(dir, "packages");

  return Fs.readdirSync(pkgPath).reduce((acc, k) => {
    try {
      const path = Path.join(pkgPath, k);
      const pkgFile = Path.join(path, "package.json");
      const pkgStr = Fs.readFileSync(pkgFile);
      const pkgJson = JSON.parse(pkgStr);
      acc[pkgJson.name] = Object.assign(
        _.pick(pkgJson, [
          "name",
          "version",
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies"
        ]),
        {
          localDeps: [],
          dependents: [],
          indirectDeps: [],
          path,
          pkgFile,
          pkgStr,
          pkgJson,
          installed: false
        }
      );
    } catch (e) {
      logger.error("readPackages", e);
    }
    return acc;
  }, {});
}

module.exports = readPackages;
