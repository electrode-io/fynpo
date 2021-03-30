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

const PACKAGE_JSON = "~package.json";

const formatPkgId = pkg => {
  if (pkg.name === PACKAGE_JSON) {
    return chalk.cyan(pkg.name);
  }
  const top = pkg.promoted ? "" : "⬇";
  return `${logFormat.pkgId(pkg)}${top}`;
};

const getPkgId = pkg => {
  if (pkg.name === PACKAGE_JSON) {
    return pkg.name;
  }

  return `${pkg.name}@${pkg.version}`;
};

class ShowStat {
  constructor({ fyn }) {
    this._fyn = fyn;
    this._fyn._options.buildLocal = false;
  }

  // returns array of packages match id
  findPkgsById(pkgs, id) {
    const ix = id.indexOf("@", 1);
    const sx = ix > 0 ? ix : id.length;
    const name = id.substr(0, sx);
    const semver = id.substr(sx + 1);

    return _(pkgs[name])
      .map((vpkg, version) => {
        if (!semver || semverUtil.satisfies(version, semver)) {
          return vpkg;
        }
      })
      .filter(x => x)
      .value();
  }

  findDependents(pkgs, ask) {
    const dependents = [];
    if (!this._fynRes) {
      const depLinker = new PkgDepLinker({ fyn: this._fyn });
      this._fynRes = depLinker.makeAppFynRes(this._fyn._data.res, {});
    }

    const check = (res, vpkg) => {
      const semv = ask.local ? semverUtil.unlocalify(ask.version) : ask.version;
      if (res && semverUtil.satisfies(res.resolved, semv)) {
        dependents.push(vpkg);
      }
    };

    // check indirect packages
    for (const name in pkgs) {
      const pkg = pkgs[name];
      for (const version in pkg) {
        const vpkg = pkg[version];

        // no dev because those aren't installed anyways
        ["dep", "opt", "per"].forEach(s => {
          const x = vpkg.res[s];
          check(x && x[ask.name], vpkg);
        });
      }
    }
    // check app itself
    check(this._fynRes[ask.name], { name: PACKAGE_JSON, promoted: true });

    return dependents;
  }

  showPkgDependents(pkgs, ask) {
    const dependents = this.findDependents(pkgs, ask).sort((a, b) => {
      if (a.name === b.name) {
        return semverUtil.simpleCompare(a.version, b.version);
      }
      return a.name > b.name ? 1 : -1;
    });

    if (dependents.length > 0) {
      logger
        .prefix("")
        .info(
          "=>",
          logFormat.pkgId(ask),
          `has ${dependents.length} dependents:`,
          dependents.map(formatPkgId).join(" ")
        );
    }

    return dependents;
  }

  _show(pkgIds) {
    const data = this._fyn._data;
    this._dependentsCache = {};
    let groups = {};

    return Promise.each(pkgIds, pkgId => {
      const askPkgs = this.findPkgsById(data.pkgs, pkgId).sort((a, b) =>
        semverUtil.simpleCompare(a.version, b.version)
      );

      if (askPkgs.length === 0) {
        logger.prefix("").info(chalk.yellow(pkgId), "is not installed");
      } else {
        logger
          .prefix("")
          .info(
            chalk.green.bgRed(pkgId),
            "matched these installed versions",
            askPkgs.map(formatPkgId).join(" ")
          );

        return Promise.each(askPkgs, ask => {
          const specificId = getPkgId(ask);
          const deps = this.showPkgDependents(data.pkgs, ask);

          this._allPaths = [];

          return this._findDepPaths(deps.map(getPkgId), [specificId]).then(() => {
            const newGroups = _.groupBy(this._allPaths, x => x[x.length - 1]);
            groups = { ...groups, ...newGroups };
            const paths = groups[specificId];
            if (paths && paths.length > 0) {
              this._displayPaths(specificId, paths);
            }
          });
        });
      }
    }).then(() => {
      logger.info(chalk.green(`stat completed for ${pkgIds.join(" ")}`));
    });
  }

  _findDepPaths(pkgIds, output = []) {
    const data = this._fyn._data;

    return Promise.each(pkgIds, pkgId => {
      const askPkgs = this.findPkgsById(data.pkgs, pkgId).sort((a, b) =>
        semverUtil.simpleCompare(a.version, b.version)
      );

      if (askPkgs.length < 1) {
        this._allPaths.push((pkgId !== PACKAGE_JSON ? [pkgId] : []).concat(output));
        return undefined;
      }

      return Promise.map(
        askPkgs,
        pkg => {
          const pkgId = getPkgId(pkg);

          if (output.indexOf(pkgId) >= 0) {
            logger.debug("stat detected circular dependency:", pkgId, output.join(" "));
            return;
          }

          let dependents = this._dependentsCache[pkgId];
          if (!dependents) {
            this._dependentsCache[pkgId] = dependents = this.findDependents(data.pkgs, pkg).sort(
              (a, b) => {
                if (a.name === b.name) {
                  return semverUtil.simpleCompare(a.version, b.version);
                }
                return a.name > b.name ? 1 : -1;
              }
            );
          }

          const followIds = dependents
            .filter(x => x.name !== PACKAGE_JSON)
            .map(x => `${x.name}@${x.version.replace("-fynlocal_h", "")}`);

          if (dependents.length > 0) {
            const newOutput = [pkgId].concat(output);
            if (followIds.length > 0) {
              return this._findDepPaths(followIds, newOutput);
            } else if (output) {
              this._allPaths.push(newOutput);
            }
          } else {
            logger.prefix("").info("no dependents for", pkgId);
          }
        },
        { concurrency: 1 }
      );
    });
  }

  _displayPaths(pkgId, paths) {
    /**
     * A > B > C > x
     * A > B > D > x
     * A > E > B > C > x
     * // we actually don't want to show last path because B > C > x already occurred
     */

    const cmpDepPath = (a, b) => {
      for (let ixA = 0; ixA < a.length; ixA++) {
        if (b.length <= ixA) {
          return 1;
        }
        const aId = a[ixA];
        const bId = b[ixA];
        if (aId !== bId) {
          return aId > bId ? 1 : -1;
        }
      }
      return 0;
    };

    paths = paths.sort((a, b) => a.length - b.length);
    let minDetails = 5;

    let briefPaths = paths;
    while (briefPaths.length > 10 && minDetails > 0) {
      const occurLevels = {};
      briefPaths = paths.filter(dp => {
        const last = dp.length - 1;
        for (let ix = 0; ix < last; ix++) {
          const pkgId = dp[ix];
          const occur = occurLevels[pkgId];
          if (occur && occur.level < ix && occur.leaf === dp[last] && dp.length - ix > minDetails) {
            return false;
          }
          occurLevels[pkgId] = {
            level: ix,
            leaf: dp[last]
          };
        }
        return true;
      });

      minDetails--;
    }

    briefPaths = briefPaths.sort(cmpDepPath);

    const msg =
      paths.length === briefPaths.length
        ? `these dependency paths:`
        : `${paths.length} dependency paths, showing the ${briefPaths.length} most significant ones below:`;
    logger.prefix("").info(`=> ${pkgId} has ${msg}`);
    logger.prefix("").info(briefPaths.map(x => `  > ` + x.join(" > ")).join("\n"));
  }

  showStat(pkgIds) {
    const spinner = CliLogger.spinners[1];
    logger.addItem({ name: FETCH_META, color: "green", spinner });
    logger.updateItem(FETCH_META, "resolving dependencies...");
    return Promise.resolve(this._fyn.resolveDependencies())
      .then(() => {
        logger.removeItem(FETCH_META);
        return this._show(pkgIds);
      })
      .catch(err => {
        logger.error(err);
      })
      .finally(() => {
        logger.removeItem(FETCH_META);
      });
  }
}

module.exports = (fyn, pkgIds) => {
  return new ShowStat({ fyn }).showStat(pkgIds);
};
