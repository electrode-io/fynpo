"use strict";

const chalk = require("chalk");
const CliLogger = require("../lib/cli-logger");
const logger = require("../lib/logger");
const _ = require("lodash");
const semverUtil = require("../lib/util/semver");
const Promise = require("bluebird");
const logFormat = require("../lib/util/log-format");
const PkgDepLinker = require("../lib/pkg-dep-linker");
const { FETCH_META } = require("../lib/log-items");

// returns array of packages match id
function findPkgsById(pkgs, id) {
  const ix = id.indexOf("@", 1);
  const sx = ix > 0 ? ix : id.length;
  const name = id.substr(0, sx);
  const semver = id.substr(sx + 1) || "*";

  logger.info("id", id, "name", name, "semver", semver);

  return _(pkgs[name])
    .map((vpkg, version) => {
      if (semverUtil.satisfies(version, semver)) {
        return vpkg;
      }
    })
    .filter(x => x)
    .value();
}

function findDependents(fyn, pkgs, ask) {
  const depLinker = new PkgDepLinker({ fyn });
  return _(pkgs)
    .map((pkg, name) => {
      return _(pkg)
        .map((vpkg, version) => {
          depLinker.loadPkgDepData(vpkg);
          const res = _.get(vpkg, ["json", "_depResolutions", ask.name]);
          return res && semverUtil.satisfies(res.resolved, ask.version) && vpkg;
        })
        .filter(x => x)
        .value();
    })
    .flatMap()
    .value();
}

function formatPkgId(pkg) {
  const top = pkg.promoted ? "" : "(fv)";
  return `${logFormat.pkgId(pkg)}${top}`;
}

function showPkgStat(fyn, pkgs, ask) {
  const dependents = findDependents(fyn, pkgs, ask).sort((a, b) => {
    if (a.name === b.name) {
      return semverUtil.simpleCompare(a.version, b.version);
    }
    return a.name > b.name ? 1 : -1;
  });

  logger.info(logFormat.pkgId(ask), "has these dependents", dependents.map(formatPkgId).join(", "));
}

function showStat(fyn, pkgIds) {
  const spinner = CliLogger.spinners[1];
  logger.addItem({ name: FETCH_META, color: "green", spinner });
  logger.updateItem(FETCH_META, "resolving dependencies...");
  return fyn
    .resolveDependencies()
    .then(() => {
      logger.removeItem(FETCH_META);
      const data = fyn._data;
      return Promise.each(pkgIds, pkgId => {
        const askPkgs = findPkgsById(data.pkgs, pkgId).sort((a, b) =>
          semverUtil.simpleCompare(a.version, b.version)
        );
        if (askPkgs.length === 0) {
          logger.info(chalk.yellow(pkgId), "is not installed");
        } else {
          logger.info(
            chalk.green.bgRed(pkgId),
            "matched these installed versions",
            askPkgs.map(formatPkgId).join(", ")
          );
          return Promise.each(askPkgs, id => showPkgStat(fyn, data.pkgs, id));
        }
      });
    })
    .catch(err => {
      logger.error(err);
    })
    .finally(() => {
      logger.removeItem(FETCH_META);
    });
}

module.exports = showStat;
