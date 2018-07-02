"use strict";

const Path = require("path");
const Fs = require("./util/file-ops");
const Promise = require("bluebird");
const _ = require("lodash");
const chalk = require("chalk");
const PkgDepLinker = require("./pkg-dep-linker");
const PkgBinLinker = require("./pkg-bin-linker");
const PkgDepLocker = require("./pkg-dep-locker");
const LifecycleScripts = require("./lifecycle-scripts");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const fynTil = require("./util/fyntil");
const { INSTALL_PACKAGE } = require("./log-items");

const { SEMVER } = require("./symbols");

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

  async install() {
    this.preInstall = [];
    this.postInstall = [];
    this.toLink = [];
    this._data.cleanLinked();
    this._fyn._depResolver.resolvePkgPeerDep(this._fyn._pkg, "your app", this._data);
    // go through each package and insert
    // _depResolutions into its package.json
    const pkgsData = this._data.getPkgsData();
    for (const info of this._data.resolvedPackages) {
      const depInfo = pkgsData[info.name][info.version];
      logger.debug("queuing", depInfo.name, depInfo.version, "for install");
      await this._gatherPkg(depInfo);
    }

    this._depLinker.linkApp(this._data.res, this._fynFo, this._fyn.getOutputDir());

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

    const vdir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);
    await this._depLinker.linkLocalPackage(vdir, depInfo.dir);
    this._depLinker.loadLocalPackageAppFynLink(depInfo, vdir);
  }

  _savePkgJson(log) {
    return Promise.each(this.toLink, depInfo => {
      if (depInfo.local) {
        // return so don't override locally linked module's package.json
        return this._depLinker.saveLocalPackageFynLink(depInfo);
      }
      depInfo.json._from = `${depInfo.name}@${depInfo[SEMVER]}`;
      depInfo.json._id = `${depInfo.name}@${depInfo.version}`;
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
        return Fs.writeFile(Path.join(depInfo.dir, "package.json"), outputStr);
      }
      return undefined;
    });
  }

  _doInstall() {
    const start = Date.now();
    const appDir = this._fyn.cwd;

    const running = [];
    const updateRunning = s => {
      logger.updateItem(INSTALL_PACKAGE, `running ${s}: ${running.join(", ")}`);
    };

    const removeRunning = (step, pkgId) => {
      const x = running.indexOf(pkgId);
      running.splice(x, 1);
      updateRunning(step);
    };

    const runNpm = (scripts, depInfo, ignoreFailure) => {
      const pkgId = logFormat.pkgId(depInfo);

      return Promise.map(
        scripts,
        script => {
          running.push(pkgId);
          updateRunning(script);
          const ls = new LifecycleScripts(Object.assign({ appDir, _fyn: this._fyn }, depInfo));
          return ls
            .execute(script, true)
            .then(() => undefined)
            .catch(e => {
              if (!ignoreFailure) throw e;
              logger.warn(
                chalk.yellow(`ignoring ${pkgId} npm script ${script} failure`, chalk.red(e.message))
              );
              return e;
            })
            .finally(() => {
              removeRunning(script, pkgId);
            });
        },
        { concurrency: 1 }
      ).then(errors => errors.filter(_.identity));
    };

    return Promise.map(
      this.preInstall,
      depInfo => {
        return runNpm(["preinstall"], depInfo, false).then(() => {
          depInfo.json._fyn.install = true;
          if (depInfo.fynLinkData) {
            depInfo.fynLinkData.install = true;
          }
        });
      },
      { concurrency: 3 }
    )
      .return(this.toLink)
      .each(depInfo => {
        const pkgId = logFormat.pkgId(depInfo);
        logger.updateItem(INSTALL_PACKAGE, `linking package ${pkgId}`);
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
      })
      .tap(() => logger.debug("linking bin for non-top but promoted packages"))
      .return(this.toLink) // Link bin for all none top but promoted pkg first
      .each(x => !x.top && x.promoted && this._binLinker.linkBin(x))
      .tap(() => logger.debug("linking bin for __fv_ packages"))
      .return(this.toLink) // Link bin for all pkg under __fv_
      .each(x => !x.top && !x.promoted && this._binLinker.linkBin(x))
      .then(() => this._savePkgJson())
      .then(() => this._initFvVersions())
      .then(() => this._cleanUp())
      .then(() => this._cleanBin())
      .return(this.postInstall)
      .map(
        depInfo => {
          return runNpm(depInfo.install, depInfo, false).then(() => {
            depInfo.json._fyn.install = true;
            if (depInfo.fynLinkData) {
              depInfo.fynLinkData.install = true;
            }
          });
        },
        { concurrency: 3 }
      )
      .then(() => this._savePkgJson(true))
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
      });
  }

  async _gatherPkg(depInfo) {
    const { name, version } = depInfo;
    if (depInfo.local) await this._linkLocalPkg(depInfo);

    const json = depInfo.json || {};

    if (_.isEmpty(json) || json.fromLocked) {
      const dir = this._fyn.getInstalledPkgDir(name, version, depInfo);
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

    if (!json._fyn.install) {
      const install = ["install", "postinstall", "postInstall"].filter(x => Boolean(scripts[x]));
      if (install.length > 0) {
        logger.debug("adding install step for", depInfo.dir);
        depInfo.install = install;
        this.postInstall.push(depInfo);
      }
    }
  }

  _cleanBin() {
    logger.updateItem(INSTALL_PACKAGE, "cleaning node_modules/.bin");
    this._binLinker.clearExtras();
  }

  async _initFvVersions() {
    if (!this._fvVersions) {
      this._fvVersions = await this._fyn.loadFvVersions();
    }
  }

  async _cleanUp(scope) {
    const outDir = this._fyn.getOutputDir();
    const pkgsData = this._data.getPkgsData();

    scope = scope || "";
    logger.updateItem(INSTALL_PACKAGE, `cleaning extraneous packages... ${scope}`);

    const installedPkgs = await Fs.readdir(Path.join(outDir, scope));
    for (const dirName of installedPkgs) {
      if (dirName.startsWith(".") || dirName.startsWith("_")) continue;

      if (!scope && dirName.startsWith("@")) {
        await this._cleanUp(dirName);
        continue;
      }

      const pkgName = Path.posix.join(scope, dirName);
      const pkgVersions = pkgsData[pkgName];
      const topPkg = _.find(pkgVersions, x => x.promoted);

      if (!topPkg) {
        logger.verbose("removing extraneous top level package", pkgName);

        this._removedCount++;
        await this._removeDir(Path.join(outDir, pkgName));
      }

      await this._cleanUpVersions(outDir, pkgName);
    }

    // get rid of potentially empty scope dir
    try {
      if (scope) await Fs.rmdir(Path.join(outDir, scope));
    } catch (err) {}

    // get rid of potentially empty __fv_ dir
    try {
      await Fs.rmdir(this._fyn.getFvDir());
    } catch (err) {}
  }

  async _cleanUpVersions(outDir, pkgName) {
    const pkg = this._data.getPkgsData()[pkgName];
    const versions = this._fvVersions[pkgName];

    if (!versions || versions.length < 1) return;

    for (const ver of versions) {
      if (!pkg || !pkg[ver] || pkg[ver].promoted) {
        const pkgInstalledPath = this._fyn.getFvDir(Path.join(ver, pkgName));

        const stat = await Fs.lstat(pkgInstalledPath);

        if (stat.isSymbolicLink()) {
          logger.debug("removing symlink extraneous version", ver, "of", pkgName);
          await Fs.$.rimraf(this._fyn.getFvDir(Path.join(ver, fynTil.makeFynLinkFName(pkgName))));

          try {
            await Fs.unlink(pkgInstalledPath);
          } catch (err) {
            logger.error(`unlink symlink version ${pkgInstalledPath} failed`, err);
          }
        } else if (stat.isDirectory()) {
          logger.verbose("removing extraneous version", ver, "of", pkgName);
          await Fs.$.rimraf(pkgInstalledPath);
        }

        // a scoped package, remove the scope dir
        try {
          if (pkgName.startsWith("@")) await Fs.rmdir(Path.join(pkgInstalledPath, ".."));
        } catch (e) {}
      }

      try {
        await Fs.rmdir(this._fyn.getFvDir(ver));
      } catch (e) {}
    }
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
