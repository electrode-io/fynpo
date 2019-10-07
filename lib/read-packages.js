"use strict";

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const logger = require("./logger");
const scanDir = require("filter-scan-dir");

function readPackages(dir) {
  const pkgPath = Path.join(dir, "packages");

  return scanDir
    .sync({
      dir: pkgPath,
      includeRoot: true,
      maxLevel: 1,
      filter: f => f === "package.json"
    })
    .reduce((acc, pkgFile) => {
      try {
        const path = Path.dirname(pkgFile);
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
            pkgDir: Path.basename(path),
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
