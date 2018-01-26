"use strict";

const Path = require("path");
const Fs = require("fs");
const Promise = require("bluebird");
const rimraf = require("rimraf");
const _ = require("lodash");
const chalk = require("chalk");
const PkgDepLinker = require("./pkg-dep-linker");
const PkgBinLinker = require("./pkg-bin-linker");
const PkgDepLocker = require("./pkg-dep-locker");
const LifecycleScripts = require("./lifecycle-scripts");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const { INSTALL_PACKAGE } = require("./log-items");

/* eslint-disable max-statements,no-magic-numbers,no-empty,complexity */

class PkgInstaller {
  constructor(options) {
    this._fyn = options.fyn;
    this._data = this._fyn._data;
    this._depLinker = new PkgDepLinker({ fyn: this._fyn });
    const outputDir = this._fyn.getOutputDir();
    this._binLinker = new PkgBinLinker({ outputDir, fyn: options.fyn });
    this._fynRes = this._depLinker.readAppRes(outputDir);
    this._fynFo = this._fynRes._fynFo;
  }

  install() {
    this.preInstall = [];
    this.postInstall = [];
    this.toLink = [];
    this._data.cleanLinked();
    this._fyn._depResolver.resolvePkgPeerDep(this._fyn._pkg, "your app", this._data);
    // go through each package and insert
    // _depResolutions into its package.json
    _.each(this._data.getPkgsData(), (pkg, name) => {
      this._gatherPkg(pkg, name);
    });

    this._depLinker.linkApp(this._data.res, this._fynFo, this._fyn.getOutputDir());

    return this._doInstall().finally(() => {
      this.preInstall = undefined;
      this.postInstall = undefined;
      this.toLink = undefined;
    });
  }

  _linkLocalPkg(depInfo) {
    // avoid linking multiple times
    if (depInfo.linkLocal) return;
    depInfo.linkLocal = true;

    const vdir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, { promoted: false });
    this._depLinker.linkLocalPackage(vdir, depInfo.dir);
    this._depLinker.loadLocalPackageAppFynLink(depInfo, vdir);
  }

  _savePkgJson(log) {
    _.each(this.toLink, depInfo => {
      if (depInfo.local) {
        this._depLinker.saveLocalPackageFynLink(depInfo);
        return; // don't override locally linked module's package.json
      }
      const outputStr = `${JSON.stringify(depInfo.json, null, 2)}\n`;
      if (depInfo.str !== outputStr) {
        if (log && depInfo.linkDep) {
          const pkgJson = depInfo.json;
          logger.debug(
            "linked dependencies for",
            pkgJson.name,
            pkgJson.version,
            depInfo.promoted ? "" : "__fv_"
          );
        }
        Fs.writeFileSync(Path.join(depInfo.dir, "package.json"), outputStr);
      }
    });
  }

  _doInstall() {
    const start = Date.now();
    const appDir = this._fyn.cwd;

    const running = [];
    const updateRunning = s => {
      logger.updateItem(INSTALL_PACKAGE, `running ${s}: ${running.join(", ")}`);
    };
    const removeRunning = pkgId => {
      const x = running.indexOf(pkgId);
      running.splice(x, 1);
      updateRunning("preinstall");
    };
    return Promise.resolve(this.preInstall)
      .map(
        depInfo => {
          const pkgId = logFormat.pkgId(depInfo);
          running.push(pkgId);
          updateRunning("preinstall");
          const ls = new LifecycleScripts(Object.assign({ appDir }, depInfo));
          return ls
            .execute(["preinstall"], true)
            .then(() => {
              depInfo.json._fyn.preinstall = true;
              if (depInfo.fynLinkData) {
                depInfo.fynLinkData.preinstall = true;
              }
            })
            .finally(() => {
              removeRunning(pkgId);
            });
        },
        { concurrency: 3 }
      )
      .then(() => {
        _.each(this.toLink, depInfo => {
          const pkgId = logFormat.pkgId(depInfo);
          logger.updateItem(INSTALL_PACKAGE, `linking ${pkgId}`);
          this._fyn._depResolver.resolvePeerDep(depInfo);
          this._depLinker.linkPackage(depInfo);
          //
          if (depInfo.deprecated && !depInfo.json._deprecated) {
            depInfo.json._deprecated = depInfo.deprecated;
            depInfo.showDepr = true;
          }
          if (depInfo.top) {
            this._binLinker.linkBin(depInfo);
          }
        });

        logger.debug("linking non-top dep bin");
        _.each(this.toLink, depInfo => {
          if (!depInfo.top && depInfo.promoted) {
            this._binLinker.linkBin(depInfo);
          }
        });

        _.each(this.toLink, depInfo => {
          if (!depInfo.top && !depInfo.promoted) {
            this._binLinker.linkBin(depInfo);
          }
        });
      })
      .then(() => this._savePkgJson())
      .then(() => this._cleanUp())
      .then(() => this._cleanBin())
      .return(this.postInstall)
      .map(
        depInfo => {
          const pkgId = logFormat.pkgId(depInfo);
          running.push(pkgId);
          updateRunning("install");
          const ls = new LifecycleScripts(Object.assign({ appDir }, depInfo));
          return ls
            .execute(depInfo.install, true)
            .then(() => {
              depInfo.json._fyn.install = true;
              if (depInfo.fynLinkData) {
                depInfo.fynLinkData.install = true;
              }
            })
            .catch(e => {
              logger.warn(
                chalk.yellow(`ignoring ${pkgId} npm script install failure`, chalk.red(e.message))
              );
            })
            .finally(() => {
              removeRunning(pkgId);
            });
        },
        { concurrency: 3 }
      )
      .then(() => this._savePkgJson(true))
      .then(() => {
        let count = 0;
        const forceShow = this._fyn.showDeprecated;
        _.each(this.toLink, di => {
          if (di.deprecated && (di.showDepr || forceShow)) {
            count++;
            const id = logFormat.pkgId(di);
            logger.warn(
              `${chalk.black.bgYellow("WARN")} ${chalk.magenta("deprecated")} ${id}`,
              chalk.yellow(di.deprecated)
            );
            const req = di.requests[di.firstReqIdx];
            logger.verbose(
              chalk.blue("  First seen through:"),
              chalk.cyan((req.length > 1 ? req.slice(1) : req).reverse().join(chalk.magenta(" < ")))
            );
            if (di.requests.length > 1) {
              logger.verbose(chalk.blue(`  Number of other dep paths:`), di.requests.length - 1);
            }
          }
        });
        if (forceShow && !count) {
          logger.info(chalk.green("HOORAY!!! None of your dependencies are marked deprecated."));
        }
      })
      .then(() => this._saveLockData())
      .then(() => {
        logger.info(`${chalk.green("done install")} ${logFormat.time(Date.now() - start)}`);
      })
      .finally(() => {
        logger.removeItem(INSTALL_PACKAGE);
      });
  }

  _gatherPkg(pkg, name) {
    _.each(pkg, (depInfo, version) => {
      if (depInfo.local) this._linkLocalPkg(depInfo);

      const json = depInfo.json || {};

      if (_.isEmpty(json) || json.fromLocked) {
        const dir = this._fyn.getInstalledPkgDir(name, version, depInfo);
        const file = Path.join(dir, "package.json");
        const str = Fs.readFileSync(file).toString();
        Object.assign(json, JSON.parse(str));
        Object.assign(depInfo, { str, json });
        if (!depInfo.dir) depInfo.dir = dir;
      }

      if (!json._fyn) json._fyn = {};
      const scripts = json.scripts || {};
      const hasPI = json.hasPI || Boolean(scripts.preinstall);
      const piExed = json._fyn.preinstall || Boolean(depInfo.preinstall);

      if (!piExed && hasPI) {
        if (depInfo.preInstalled) {
          json._fyn.preinstall = true;
        } else {
          logger.debug("adding preinstall step for", depInfo.dir);
          this.preInstall.push(depInfo);
        }
      }

      this.toLink.push(depInfo);

      if (!json._fyn.install) {
        const install = ["install", "postinstall", "postInstall"].filter(x => Boolean(scripts[x]));
        if (install.length > 0) {
          logger.debug("adding install step for", depInfo.dir);
          depInfo.install = install;
          this.postInstall.push(depInfo);
        }
      }
    });
  }

  _cleanBin() {
    logger.updateItem(INSTALL_PACKAGE, "cleaning node_modules/.bin");
    this._binLinker.clearExtras();
  }

  _cleanUp(scope) {
    scope = scope || "";
    logger.updateItem(INSTALL_PACKAGE, `cleaning extraneous packages... ${scope}`);
    const outDir = this._fyn.getOutputDir();
    const installedPkgs = Fs.readdirSync(Path.join(outDir, scope));
    const pkgsData = this._data.getPkgsData();
    for (const ix in installedPkgs) {
      const dirName = installedPkgs[ix];
      if (dirName.startsWith(".") || dirName.startsWith("_")) continue;
      if (!scope && dirName.startsWith("@")) {
        this._cleanUp(dirName);
        continue;
      }
      const pkgName = Path.join(scope, dirName);
      const iPkg = pkgsData[pkgName];
      const vpkg = _.find(iPkg, x => x.promoted);
      if (!vpkg) {
        logger.verbose("removing extraneous top level package", pkgName);
        if (_.isEmpty(iPkg)) {
          this._removeDir(Path.join(outDir, pkgName));
        } else {
          this._fyn.clearPkgOutDirSync(Path.join(outDir, pkgName));
        }
        this._removedCount++;
      } else {
        this._cleanUpVersions(outDir, pkgName);
      }
    }
    if (scope) {
      try {
        Fs.rmdirSync(Path.join(outDir, scope));
      } catch (err) {}
    }
  }

  _cleanUpVersions(outDir, pkgName) {
    try {
      const pkg = this._data.getPkgsData()[pkgName];
      const fvDir = Path.join(outDir, pkgName, "__fv_");
      const versions = Fs.readdirSync(fvDir);
      if (versions.length < 1) return;
      for (const vx in versions) {
        const ver = versions[vx];
        if (!pkg[ver] || pkg[ver].promoted) {
          const stat = Fs.statSync(Path.join(fvDir, ver, pkgName));
          if (!stat.isSymbolicLink()) {
            logger.verbose("removing extraneous version", ver, "of", pkgName);
            this._removeDir(Path.join(fvDir, ver));
          } else {
            logger.info("Not removing symlink extraneous version", ver, "of", pkgName);
          }
        }
      }
      Fs.rmdirSync(fvDir);
    } catch (err) {
      if (err.code !== "ENOENT" && err.code !== "ENOTEMPTY") {
        logger.error("cleanUpVersions failed", err);
      }
    }
  }

  _removeDir(dir) {
    try {
      const stat = Fs.statSync(dir);
      if (stat.isDirectory()) {
        rimraf.sync(dir);
      }
    } catch (err) {}
  }

  _saveLockData() {
    if (!this._fyn.lockOnly) {
      const locker = this._fyn._depLocker || new PkgDepLocker();
      locker.generate(this._fyn._data);
      locker.save(Path.join(this._fyn.cwd, "fyn-lock.yaml"));
    }
  }
}

module.exports = PkgInstaller;
