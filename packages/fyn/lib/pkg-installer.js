"use strict";

const Path = require("path");
const Fs = require("./util/file-ops");
const Promise = require("bluebird");
const _ = require("lodash");
const chalk = require("chalk");
const PkgDepLinker = require("./pkg-dep-linker");
const PkgBinLinker = require("./pkg-bin-linker");
const PkgDepLocker = require("./pkg-dep-locker");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const fynTil = require("./util/fyntil");
const hardLinkDir = require("./util/hard-link-dir");
const { INSTALL_PACKAGE } = require("./log-items");
const runNpmScript = require("./util/run-npm-script");

const { SEMVER } = require("./symbols");

/* eslint-disable max-statements,no-magic-numbers,no-empty,complexity */

class PkgInstaller {
  constructor(options) {
    this._fyn = options.fyn;
    this._data = this._fyn._data;
    this._depLinker = new PkgDepLinker({ fyn: this._fyn });
  }

  async install() {
    const outputDir = this._fyn.getOutputDir();
    this._binLinker = new PkgBinLinker({ outputDir, fyn: this._fyn });
    this._fynRes = await this._depLinker.readAppRes(outputDir);
    this._fynFo = this._fynRes._fynFo;

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

    await this._depLinker.linkApp(this._data.res, this._fynFo, this._fyn.getOutputDir());

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
    if (depInfo.local === "hard") {
      await hardLinkDir.link(depInfo.dir, vdir, ["node_modules"]);
    } else {
      await this._depLinker.symlinkLocalPackage(vdir, depInfo.dir);
      await this._depLinker.loadLocalPackageAppFynLink(depInfo, vdir);
    }
  }

  async _saveLocalFynSymlink() {
    for (const depInfo of this.toLink) {
      if (depInfo.local === "sym") {
        // return so don't override locally linked module's package.json
        await this._depLinker.saveLocalPackageFynLink(depInfo);
      }
    }
  }

  async _savePkgJson(log) {
    for (const depInfo of this.toLink) {
      // can't touch package.json if package is a symlink to the real
      // local package.
      if (depInfo.local === "sym") {
        continue;
      }

      depInfo.json._from = `${depInfo.name}@${depInfo[SEMVER]}`;
      depInfo.json._id = `${depInfo.name}@${depInfo.version}`;
      const outputStr = JSON.stringify(depInfo.json, null, 2);

      if (log && depInfo.linkDep) {
        const pkgJson = depInfo.json;
        logger.debug(
          "linked dependencies for",
          pkgJson.name,
          pkgJson.version,
          depInfo.promoted ? "" : "__fv_"
        );
      }

      if (depInfo.str.trim() === outputStr.trim()) {
        continue;
      }

      let pkgJsonFp;

      if (depInfo.local === "hard") {
        // do not override hard linked package.json, instead remove it and
        // write a new physical file.
        const vdir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);
        pkgJsonFp = Path.join(vdir, "package.json");
        await Fs.unlink(pkgJsonFp);
      } else {
        pkgJsonFp = Path.join(depInfo.dir, "package.json");
      }

      depInfo.str = outputStr;

      await Fs.writeFile(pkgJsonFp, `${outputStr}\n`);
    }
  }

  _doInstall() {
    const start = Date.now();
    const appDir = this._fyn.cwd;

    let stepTime = start;
    const timeCheck = x => {
      const tmp = Date.now();
      logger.debug(`${chalk.green("install time check", x)} ${logFormat.time(tmp - stepTime)}`);
      stepTime = tmp;
    };

    return Promise.map(
      this.preInstall,
      depInfo => {
        return runNpmScript({ appDir, fyn: this._fyn, scripts: ["preinstall"], depInfo }).then(
          () => {
            depInfo.json._fyn.install = true;
            if (depInfo.fynLinkData) {
              depInfo.fynLinkData.install = true;
            }
          }
        );
      },
      { concurrency: 3 }
    )
      .tap(() => timeCheck("preInstall"))
      .tap(() => {
        logger.updateItem(INSTALL_PACKAGE, `linking packages...`);
      })
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
      .tap(() => timeCheck("linking packages"))
      .tap(() => logger.debug("linking bin for non-top but promoted packages"))
      .return(this.toLink) // Link bin for all none top but promoted pkg first
      .each(x => !x.top && x.promoted && this._binLinker.linkBin(x))
      .tap(() => timeCheck("linking bin promoted non-top"))
      .tap(() => logger.debug("linking bin for __fv_ packages"))
      .return(this.toLink) // Link bin for all pkg under __fv_
      .each(x => !x.top && !x.promoted && this._binLinker.linkBin(x))
      .tap(() => timeCheck("linking bin __fv_"))
      .then(() => {
        // we are about to run install/postInstall scripts
        // save pkg JSON to disk in case any updates were done
        return this._savePkgJson();
      })
      .tap(() => timeCheck("first _savePkgJson"))
      .then(() => this._initFvVersions())
      .tap(() => timeCheck("_initFvVersions"))
      .then(() => this._cleanUp())
      .tap(() => timeCheck("_cleanUp"))
      .then(() => this._cleanOrphanedFv())
      .tap(() => timeCheck("_cleanOrphanedFv"))
      .then(() => this._cleanBin())
      .tap(() => timeCheck("_cleanBin"))
      .return(this.postInstall)
      .map(
        depInfo => {
          return runNpmScript({ appDir, fyn: this._fyn, scripts: depInfo.install, depInfo }).then(
            () => {
              depInfo.json._fyn.install = true;
              if (depInfo.fynLinkData) {
                depInfo.fynLinkData.install = true;
              }
            }
          );
        },
        { concurrency: 3 }
      )
      .tap(() => timeCheck("postInstall"))
      .then(() => {
        // Go through save package.json again in case any changed
        return this._savePkgJson(true);
      })
      .tap(() => timeCheck("second _savePkgJson"))
      .then(() => this._saveLocalFynSymlink())
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
      .tap(() => timeCheck("show deprecated"))
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
    if (depInfo.local) {
      await this._linkLocalPkg(depInfo);
    }

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
    return this._binLinker.clearExtras();
  }

  async _initFvVersions() {
    if (!this._fvVersions) {
      this._fvVersions = await this._fyn.loadFvVersions();
    }
  }

  async _cleanOrphanedFv() {
    const outDir = this._fyn.getOutputDir();
    for (const k in this._fvVersions) {
      const versions = this._fvVersions[k];
      if (versions !== null) {
        await this._cleanUpVersions(outDir, k);
      }
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
          logger.verbose("removing extraneous version", ver, "of", pkgName, pkgInstalledPath);
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
