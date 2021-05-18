"use strict";

const Path = require("path");
const Promise = require("bluebird");
const _ = require("lodash");
const chalk = require("chalk");
const Fs = require("./util/file-ops");
const PkgDepLinker = require("./pkg-dep-linker");
const PkgBinLinker = require("./pkg-bin-linker");
const PkgDepLocker = require("./pkg-dep-locker");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const fynTil = require("./util/fyntil");
const hardLinkDir = require("./util/hard-link-dir");
const { INSTALL_PACKAGE } = require("./log-items");
const runNpmScript = require("./util/run-npm-script");
const xaa = require("./util/xaa");

const { RESOLVE_ORDER, RSEMVERS, LOCK_RSEMVERS, SEMVER } = require("./symbols");

/* eslint-disable max-statements,no-magic-numbers,no-empty,complexity,prefer-template,max-len, max-depth */

class PkgInstaller {
  constructor(options) {
    this._fyn = options.fyn;
    this._data = this._fyn._data;
    this._depLinker = new PkgDepLinker({ fyn: this._fyn });
  }

  async install() {
    this._stepTime = Date.now();

    this.timeCheck("beginning");
    const outputDir = this._fyn.getOutputDir();
    this._binLinker = new PkgBinLinker({ outputDir, fyn: this._fyn });
    // /*deprecated*/ const fynRes = await this._depLinker.readAppFynRes(outputDir);

    this.preInstall = [];
    this.postInstall = [];
    this.toLink = [];
    this._data.cleanLinked();
    this._fyn._depResolver.resolvePkgPeerDep(this._fyn._pkg, "your app", this._data);
    // go through each package and insert
    // _depResolutions into its package.json
    const pkgsData = this._data.getPkgsData();
    this.timeCheck("queueing packages");
    for (const info of this._data.resolvedPackages) {
      const depInfo = pkgsData[info.name][info.version];
      logger.debug("queuing", depInfo.name, depInfo.version, "for install");
      await this._gatherPkg(depInfo);
    }

    // /*deprecated*/ await this._depLinker.linkAppFynRes(this._data.res, fynRes._fynFo, this._fyn.getOutputDir());

    return this._doInstall().finally(() => {
      this.preInstall = undefined;
      this.postInstall = undefined;
      this.toLink = undefined;
    });
  }

  async _linkLocalPkg(depInfo) {
    // avoid linking multiple times
    if (depInfo.linkLocal) return;
    depInfo.linkLocal = true;

    const vdir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version);
    if (depInfo.local === "hard") {
      await hardLinkDir.link(depInfo.dir, vdir, ["node_modules"]);
    } else {
      // await this._depLinker.symlinkLocalPackage(vdir, depInfo.dir);
      // await this._depLinker.loadLocalPackageAppFynLink(depInfo, vdir);
      throw new Error("only hard linking local mode supported now.  symlinking local deprecated");
    }
  }

  async _saveLocalFynSymlink() {
    throw new Error("only hard linking local mode supported now.  symlinking local deprecated");
  }

  async _savePkgJson(log) {
    for (const depInfo of this.toLink) {
      // can't touch package.json if package is a symlink to the real
      // local package.
      if (depInfo.local === "sym" || depInfo._removed) {
        continue;
      }

      depInfo.json._from = `${depInfo.name}@${depInfo[SEMVER]}`;
      depInfo.json._id = `${depInfo.name}@${depInfo.version}`;
      const outputStr = JSON.stringify(depInfo.json, null, 2);

      if (log && depInfo.linkDep) {
        const pkgJson = depInfo.json;
        logger.debug("linked dependencies for", pkgJson.name, pkgJson.version);
      }

      if (depInfo.str.trim() === outputStr.trim()) {
        continue;
      }

      let pkgJsonFp;

      if (depInfo.local === "hard") {
        // do not override hard linked package.json, instead remove it and
        // write a new physical file.
        const vdir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version);
        pkgJsonFp = Path.join(vdir, "package.json");
        await Fs.unlink(pkgJsonFp);
      } else {
        pkgJsonFp = Path.join(depInfo.dir, "package.json");
      }

      depInfo.str = outputStr;

      try {
        await Fs.writeFile(pkgJsonFp, `${outputStr}\n`);
      } catch (err) {
        //
        // some package publish files with readonly set
        //
        if (err.code === "EPERM") {
          const st = await Fs.stat(pkgJsonFp);
          // ensure allow read/write on the package.json file
          await Fs.chmod(pkgJsonFp, st.mode + 0o600);
          await Fs.writeFile(pkgJsonFp, `${outputStr}\n`);
        }
      }
    }
  }

  _isDepSrcOptionalOnly(depInfo) {
    if ((!depInfo.src || depInfo.src === "opt") && (!depInfo.dsrc || depInfo.dsrc === "opt")) {
      return true;
    }

    /*
     * Scenarios
     *
     * 1. dep of an opt A, so A can't be installed
     *   opt: A
     *      dep: failed
     * 2. opt dep of A, so can't install failed
     *   dep or opt: A
     *      opt: failed
     *
     * So as long as there's an opt along the dep path, can ignore failed.
     */

    // walk all requests
    // if all eventually came from an opt, then it's ok
    const optRequests = depInfo.requests.filter(req => req.find(r => r.startsWith("opt")));
    return optRequests.length === depInfo.requests.length; // all of them trace from opt
  }

  async _removeDepsOf(depInfo, originId) {
    if (depInfo._removingDeps || !originId) return;
    depInfo._removingDeps = true;

    const dataPackages = this._fyn._data.getPkgsData();
    const doRemove = async section => {
      if (!section) return;
      for (const name in section) {
        const pkgData = dataPackages[name];
        if (!pkgData) continue;
        const resolved = section[name].resolved;
        const pkgDepInfo = pkgData[resolved];
        if (!pkgDepInfo) continue;

        await this._removeDepsOf(pkgDepInfo, originId);
        // a simple quick check to validate if the dep can be removed
        // won't cover all scenarios so still leave some unneeded pkgs around
        const rmSemVs = pkgDepInfo.requests.reduce(
          (a, req) => {
            // extract original semv
            const sv = _.last(req).split(";")[1];
            const tgt = req.find(r => r.startsWith("opt;") && r.endsWith(originId)) ? a.opt : a.dep;
            tgt[sv] = true;
            return a;
          },
          { opt: {}, dep: {} }
        );

        if (!pkgDepInfo.optFailed) {
          for (const semv in rmSemVs.opt) {
            if (rmSemVs.dep[semv]) continue;
            if (pkgData[RSEMVERS]) delete pkgData[RSEMVERS][semv];
            if (pkgData[LOCK_RSEMVERS]) delete pkgData[LOCK_RSEMVERS][semv];
          }
        }

        if (!_.isEmpty(rmSemVs.dep)) continue;

        const dir = this._fyn.getInstalledPkgDir(pkgDepInfo.name, pkgDepInfo.version);
        logger.debug(
          "removing pkg",
          logFormat.pkgId(pkgDepInfo),
          "due to optional parent install failures, at",
          chalk.cyan(dir)
        );

        await Fs.$.rimraf(dir);
        // if a pkg's marked optFailed, then it should be kept
        if (!pkgDepInfo.optFailed) {
          delete pkgData[resolved];
          // remove resolve order
          const roIdx = pkgData[RESOLVE_ORDER].indexOf(resolved);
          if (roIdx >= 0) pkgData[RESOLVE_ORDER].splice(roIdx, 1);
          // remove rsemvers
          _.each(pkgData[RSEMVERS], (v, k) => {
            if (v === resolved) delete pkgData[RSEMVERS][k];
          });
          // remove LOCK_RSEMVERS
          _.each(pkgData[LOCK_RSEMVERS], (v, k) => {
            if (v === resolved) delete pkgData[LOCK_RSEMVERS][k];
          });
        }
      }
    };

    await doRemove(depInfo.res.dep);
    await doRemove(depInfo.res.opt);
  }

  async _removeFailedOptional(depInfo, causeId) {
    if (depInfo._removing) return;
    depInfo._removing = true;
    // - reverse search each request path to the first opt pkg
    // - if opt pkg is diff from depInfo, then need to ensure it's opt only, else fail.
    const optReqs = depInfo.requests.map(req => {
      return req.reverse().find(r => r.startsWith("opt"));
    });

    const failedId = `${depInfo.name}@${depInfo.version}`;
    for (const r of optReqs) {
      // from top level package.json, skip
      if (r === "opt") continue;
      const id = r.split(";")[2];
      // a top level opt dep would not have any parent in the request path
      // and can't remove top level package. ;-)
      if (!id && depInfo.top) continue;
      // same pkg as depInfo, skip
      if (id === failedId) continue;

      if (id) {
        // lookup new dep info, make sure it's optional only, and remove it
        const upDepInfo = this._fyn._data.getPkgById(id);
        if (!this._isDepSrcOptionalOnly(upDepInfo)) {
          throw new Error("failure chained from pkg that's more than optional");
        }
        await this._removeFailedOptional(upDepInfo, causeId || failedId);
      } else {
        break; // no more up level packages that're optionals
      }
    }
    depInfo.optFailed = 2;
    // remove files
    const causeMsg = causeId
      ? ` because its dep ${logFormat.pkgId(causeId)} failed to install`
      : "";
    logger.info(
      `${logFormat.pkgId(
        depInfo
      )}: package failed to install${causeMsg} - but will continue because it's optional`
    );

    await this._removeDepsOf(depInfo, failedId);
    await Fs.$.rimraf(this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version));
  }

  timeCheck(x) {
    const tmp = Date.now();
    logger.debug(
      `${chalk.green("install time check", x)} ${logFormat.time(tmp - this._stepTime)}`,
      new Date()
    );
    this._stepTime = tmp;
  }

  _doInstall() {
    const start = Date.now();
    const appDir = this._fyn.cwd;

    this.timeCheck("starting preinstall");

    return (
      Promise.map(
        this.preInstall,
        depInfo => {
          return runNpmScript({ appDir, fyn: this._fyn, scripts: ["preinstall"], depInfo }).then(
            () => {
              depInfo.json._fyn.preinstall = true;
              if (depInfo.fynLinkData) {
                depInfo.fynLinkData.preinstall = true;
              }
            }
          );
        },
        { concurrency: 3 }
      )
        .tap(() => this.timeCheck("preInstall"))
        .tap(() => {
          logger.updateItem(INSTALL_PACKAGE, `linking packages...`);
        })
        .then(() => this._linkTopPackages())
        .return(this.toLink)
        .each(async depInfo => {
          this._fyn._depResolver.resolvePeerDep(depInfo);
          await this._depLinker.linkPackage(depInfo);
          //
          if (depInfo.deprecated && !depInfo.json._deprecated) {
            depInfo.json._deprecated = depInfo.deprecated;
            depInfo.showDepr = true;
          }
          if (depInfo.top) {
            return this._binLinker.linkBin(depInfo);
          }
          return undefined;
        })
        .tap(() => this.timeCheck("linking packages"))
        .tap(() => logger.debug("linking bin for non-top but promoted packages"))
        .return(this.toLink) // Link bin for all none top but promoted pkg first
        .each(x => !x.top && x.promoted && this._binLinker.linkBin(x))
        .tap(() => this.timeCheck("linking bin promoted non-top"))
        .tap(() => logger.debug("linking bin for FV_DIR packages"))
        .return(this.toLink) // Link bin for all pkg under FV_DIR
        .each(x => !x.top && !x.promoted && this._binLinker.linkBin(x))
        .tap(() => this.timeCheck("linking bin FV_DIR"))
        .return(this.toLink) // link bin for package's dep that conflicts
        .each(x => this._binLinker.linkDepBin(x))
        .tap(() => this.timeCheck("linking dep bin"))
        .then(() => {
          // we are about to run install/postInstall scripts
          // save pkg JSON to disk in case any updates were done
          return this._savePkgJson();
        })
        .tap(() => this.timeCheck("first _savePkgJson"))
        .then(() => this._initFvVersions())
        .tap(() => this.timeCheck("_initFvVersions"))
        .then(() => this._cleanUp())
        .tap(() => this.timeCheck("_cleanUp"))
        .then(() => this._cleanOrphanedFv())
        .tap(() => this.timeCheck("_cleanOrphanedFv"))
        .then(() => this._cleanBin())
        .tap(() => this.timeCheck("_cleanBin"))
        .return(this.postInstall)
        .map(
          depInfo => {
            let runningScript;
            return Promise.each(depInfo.install, installScript => {
              runningScript = installScript;
              return runNpmScript({
                appDir,
                fyn: this._fyn,
                scripts: [installScript],
                depInfo
              }).then(() => {
                depInfo.json._fyn[installScript] = true;
                if (depInfo.fynLinkData) {
                  depInfo.fynLinkData[installScript] = true;
                }
              });
            }).catch(err => {
              if (this._isDepSrcOptionalOnly(depInfo)) {
                logger.info(
                  "running package",
                  logFormat.pkgId(depInfo),
                  "script",
                  chalk.magenta(runningScript),
                  `failed, but it's${depInfo.dsrc !== "opt" ? " indirect" : ""}`,
                  "optional, so ignoring and removing."
                );
                return this._removeFailedOptional(depInfo);
              } else {
                throw err;
              }
            });
          },
          { concurrency: 3 }
        )
        .tap(() => this.timeCheck("postInstall"))
        .then(() => {
          // Go through save package.json again in case any changed
          return this._savePkgJson(true);
        })
        .tap(() => this.timeCheck("second _savePkgJson"))
        // .then(() => this._saveLocalFynSymlink())
        .return(this.toLink)
        .filter(di => {
          if (di.deprecated && (di.showDepr || this._fyn.showDeprecated)) {
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
            return true;
          }
          return false;
        })
        .tap(() => this.timeCheck("show deprecated"))
        .then(warned => {
          if (this._fyn.showDeprecated && _.isEmpty(warned)) {
            logger.info(chalk.green("HOORAY!!! None of your dependencies are marked deprecated."));
          }
        })
        .then(() => this._saveLockData())
        .then(() => {
          logger.info(`${chalk.green("done install")} ${logFormat.time(Date.now() - start)}`);
        })
        .finally(() => {
          logger.removeItem(INSTALL_PACKAGE);
        })
    );
  }

  async _buildLocalPkg(depInfo) {
    if (this._fyn._localPkgBuilder) {
      await this._fyn._localPkgBuilder.waitForItem(depInfo.dir);
    } else {
      logger.error("pkg-installer: there is no this._fyn._localPkgBuilder");
    }
  }

  async _gatherPkg(depInfo) {
    const { name, version } = depInfo;
    if (depInfo.local) {
      this.timeCheck("buildLocal");
      await this._buildLocalPkg(depInfo);
      this.timeCheck("linkLocal");
      await this._linkLocalPkg(depInfo);
      this.timeCheck("done link Local");
    }

    const json = depInfo.json || {};

    if (_.isEmpty(json) || json.fromLocked) {
      const dir = this._fyn.getInstalledPkgDir(name, version);
      const file = Path.join(dir, "package.json");
      const str = (await Fs.readFile(file)).toString();
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

    const install = ["install", "postinstall"].filter(x => {
      return Boolean(scripts[x]) && !json._fyn[x];
    });

    if (install.length > 0) {
      logger.debug("adding install step for", depInfo.dir, install);
      depInfo.install = install;
      this.postInstall.push(depInfo);
    }
  }

  _cleanBin() {
    logger.updateItem(INSTALL_PACKAGE, "cleaning node_modules/.bin");
    return this._binLinker.clearExtras();
  }

  async _initFvVersions() {
    if (!this._fvVersions) {
      this._fvVersions = await this._fyn.loadFvVersions();
    }
  }

  async _cleanOrphanedFv() {
    for (const pkgName in this._fvVersions) {
      const versions = this._fvVersions[pkgName];
      if (versions !== null) {
        await this._cleanUpVersions(pkgName);
      }
    }
  }

  async _cleanUp(scope) {
    const outDir = this._fyn.getOutputDir();
    const pkgsData = this._data.getPkgsData();

    scope = scope || "";
    logger.updateItem(INSTALL_PACKAGE, `cleaning extraneous packages... ${scope}`);

    const installedPkgs = await xaa.try(() => Fs.readdir(Path.join(outDir, scope)), []);

    for (const dirName of installedPkgs) {
      if (dirName.startsWith(".") || dirName.startsWith("_")) continue;

      if (!scope && dirName.startsWith("@")) {
        await this._cleanUp(dirName);
        continue;
      }

      const pkgName = Path.posix.join(scope, dirName);
      const pkgVersions = pkgsData[pkgName];
      const topPkg = _.find(pkgVersions, x => x.promoted);

      // TODO: TASK_TOP_TO_FV update to check top pkg under FV_DIR instead
      // This won't be needed anymore.  Since all packages will be extracted to
      // node_modules/${FV_DIR}/${version}/${pkgName}
      if (!topPkg) {
        logger.verbose("removing extraneous top level package", pkgName);

        this._removedCount++;
        await this._removeDir(Path.join(outDir, pkgName));
      }

      await this._cleanUpVersions(pkgName);
    }

    // get rid of potentially empty scope dir
    if (scope) await xaa.try(() => Fs.rmdir(Path.join(outDir, scope)));

    // get rid of potentially empty FV_DIR dir
    await xaa.try(() => Fs.rmdir(this._fyn.getFvDir()));
  }

  /**
   * Make links under node_modules for packages that exist in package.json and
   * flattened packages under node_modules/${FV_DIR}/node_modules
   *
   * @returns {*} none
   */
  async _linkTopPackages() {
    const { flattenTop } = this._fyn._options;
    const pkgsData = this._data.getPkgsData();
    let createFvNmDir;
    for (const pkgName in pkgsData) {
      const pkg = pkgsData[pkgName];
      for (const version in pkg) {
        const verPkg = pkg[version];
        let symLinkLocation;
        logger.debug("linkTop", pkgName, "top", verPkg.top, "promoted", verPkg.promoted);
        if (verPkg.top) {
          // top level dep from package.json, link to node_modules
          symLinkLocation = this._fyn.getOutputDir();
        } else if (verPkg.promoted) {
          if (flattenTop) {
            symLinkLocation = this._fyn.getOutputDir();
          } else {
            // promoted flattened dep, link to node_modules/${FV_DIR}/node_modules
            symLinkLocation = this._fyn.getFvDir("node_modules");
            if (!createFvNmDir) {
              createFvNmDir = true;
              await Fs.$.mkdirp(symLinkLocation);
            }
          }
        } else {
          continue; // no need to link
        }
        const linkName = Path.join(symLinkLocation, pkgName);
        const pkgInstalledPath = this._fyn.getInstalledPkgDir(pkgName, version);
        logger.debug("linkTop", linkName, "=>", pkgInstalledPath);
        if (pkgName.startsWith("@")) {
          // scope dir
          await Fs.$.mkdirp(Path.dirname(linkName));
        }
        const symLinkExist = await fynTil.validateExistSymlink(linkName, pkgInstalledPath, true);
        if (!symLinkExist) {
          await fynTil.symlinkDir(linkName, pkgInstalledPath, true);
        }
      }
    }
  }

  async _cleanUpVersions(pkgName) {
    const pkg = this._data.getPkgsData()[pkgName];
    const versions = this._fvVersions[pkgName];

    if (!versions || versions.length < 1) return;

    const removed = [];

    for (const ver of versions) {
      if (!pkg || !pkg[ver]) {
        const pkgInstalledPath = this._fyn.getInstalledPkgDir(pkgName, ver);

        logger.verbose("removing extraneous version", ver, "of", pkgName, pkgInstalledPath);
        await Fs.$.rimraf(pkgInstalledPath);
        removed.push(pkgInstalledPath);
      }
    }

    for (const pkgDir of removed) {
      let dir = pkgDir;
      try {
        // first remove the scope dir
        if (pkgName.startsWith("@")) {
          dir = Path.dirname(dir);
          await Fs.rmdir(dir);
        }
        // next remove the version dir
        dir = Path.dirname(dir);
        await Fs.rmdir(dir);
      } catch (err) {
        if (err.code !== "ENOTEMPTY") {
          logger.error(`fail to remove dir for package ${pkgName}`, err, dir);
        }
      }
    }

    // in case the package container directory has no versions left, it'd be an empty dir => remove it.
    if (versions.length === removed.length) {
      let dir = this._fyn.getInstalledPkgDir(pkgName);
      try {
        await Fs.rmdir(dir);
        if (pkgName.startsWith("@")) {
          dir = Path.dirname(dir);
          await Fs.rmdir(dir);
        }
      } catch (err) {
        if (err.code !== "ENOTEMPTY") {
          logger.error(`fail to remove container dir for package ${pkgName}`, err, dir);
        }
      }
    }

    // cleanup applied, no longer need the data for this package

    this._fvVersions[pkgName] = null;
  }

  async _removeDir(dir) {
    try {
      const stat = await Fs.stat(dir);
      if (stat.isDirectory()) {
        return Fs.$.rimraf(dir);
      } else {
        return Fs.unlink(dir);
      }
    } catch (err) {
      return null;
    }
  }

  _saveLockData() {
    if (!this._fyn.lockOnly) {
      const locker = this._fyn._depLocker || new PkgDepLocker(false, true);
      locker.generate(this._fyn._data);
      locker.save(Path.join(this._fyn.cwd, "fyn-lock.yaml"));
    }
  }
}

module.exports = PkgInstaller;
