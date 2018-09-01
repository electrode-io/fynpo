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
  const top = pkg.promoted ? "" : "(fv)";
  return `${logFormat.pkgId(pkg)}${top}`;
};

class ShowStat {
  constructor({ fyn }) {
    this._fyn = fyn;
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

  async findDependents(pkgs, ask) {
    const dependents = [];
    if (!this._depLinker) {
      this._depLinker = new PkgDepLinker({ fyn: this._fyn });
      this._fynRes = this._depLinker.makeAppFynRes(this._fyn._data.res, {});
    }

    const check = (res, vpkg) => {
      if (res && semverUtil.satisfies(res.resolved, ask.version)) {
        dependents.push(vpkg);
      }
    };

    // check indirect packages
    for (const name in pkgs) {
      const pkg = pkgs[name];
      for (const version in pkg) {
        const vpkg = pkg[version];

        await this._depLinker.loadPkgDepData(vpkg);
        const res = _.get(vpkg, ["json", "_depResolutions", ask.name]);
        check(res, vpkg);
      }
    }
    // check app itself
    check(this._fynRes[ask.name], { name: PACKAGE_JSON, promoted: true });

    return dependents;
  }

  async showPkgStat(pkgs, ask) {
    const dependents = (await this.findDependents(pkgs, ask)).sort((a, b) => {
      if (a.name === b.name) {
        return semverUtil.simpleCompare(a.version, b.version);
      }
      return a.name > b.name ? 1 : -1;
    });

    logger.info(
      logFormat.pkgId(ask),
      "has these dependents",
      dependents.map(formatPkgId).join(", ")
    );
    return dependents;
  }

  _show(pkgIds, follow) {
    const data = this._fyn._data;
    return Promise.each(pkgIds, pkgId => {
      const askPkgs = this.findPkgsById(data.pkgs, pkgId).sort((a, b) =>
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

        return Promise.map(askPkgs, id => this.showPkgStat(data.pkgs, id), { concurrency: 1 }).then(
          askDeps => {
            if (follow > 0) {
              return Promise.each(askDeps, deps => {
                const followIds = deps
                  .filter(x => x.name !== PACKAGE_JSON)
                  .slice(0, follow)
                  .map(x => x.name);

                return this._show(followIds, follow);
              });
            }
          }
        );
      }
    });
  }

  showStat(pkgIds, follow) {
    const spinner = CliLogger.spinners[1];
    logger.addItem({ name: FETCH_META, color: "green", spinner });
    logger.updateItem(FETCH_META, "resolving dependencies...");
    return Promise.resolve(this._fyn.resolveDependencies())
      .then(() => {
        logger.removeItem(FETCH_META);
        return this._show(pkgIds, follow);
      })
      .catch(err => {
        logger.error(err);
      })
      .finally(() => {
        logger.removeItem(FETCH_META);
      });
  }
}

module.exports = (fyn, pkgIds, follow) => {
  new ShowStat({ fyn }).showStat(pkgIds, follow);
};
