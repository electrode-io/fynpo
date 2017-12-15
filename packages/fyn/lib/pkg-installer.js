"use strict";

const Path = require("path");
const Fs = require("fs");
const Crypto = require("crypto");
const Promise = require("bluebird");
const rimraf = require("rimraf");
const _ = require("lodash");
const chalk = require("chalk");
const mkdirp = require("mkdirp");
const PkgDepLinker = require("./pkg-dep-linker");
const PkgBinLinker = require("./pkg-bin-linker");
const PkgDepLocker = require("./pkg-dep-locker");
const LifecycleScripts = require("./lifecycle-scripts");
const logger = require("./logger");

const FYN_LINK_JSON = "__fyn_link__.json";

class PkgInstaller {
  constructor(options) {
    this._fyn = options.fyn;
    this._data = this._fyn._data;
    this._depLinker = new PkgDepLinker();
    this._binLinker = new PkgBinLinker({ outputDir: this._fyn.getOutputDir() });
  }

  install() {
    this.preInstall = [];
    this.postInstall = [];
    this.toLink = [];
    this._data.cleanLinked();
    this._depLinker.linkApp(this._data.res, this._fyn.getOutputDir());
    // go through each package and insert
    // _depResolutions into its package.json
    _.each(this._data.getPkgsData(), (pkg, name) => {
      this._gatherPkg(pkg, name);
    });

    logger.debug("doing install");
    return this._doInstall().finally(() => {
      this.preInstall = undefined;
      this.postInstall = undefined;
      this.toLink = undefined;
    });
  }

  _createLinkName(targetNmDir, name) {
    const sha1 = Crypto.createHash("sha1")
      .update(targetNmDir)
      .update(name)
      .digest("base64")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    return `${name.replace(/[@\/]/g, "_")}-${sha1}`;
  }

  _linkLocalPkg(depInfo) {
    if (depInfo.linkLocal) return;
    depInfo.linkLocal = true;
    const now = Date.now();
    const dir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);
    logger.info("linking local pkg dir", dir, depInfo.dir);
    this._fyn.createPkgOutDirSync(dir);
    const vdir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, { promoted: false });
    //
    // create the directory one level up so the actual package name or the second part
    // of it if it's scoped can be a symlink to the local package's directory.
    //
    this._fyn.createPkgOutDirSync(Path.join(vdir, ".."));
    const vFynLinkData = {
      name: depInfo.name,
      version: depInfo.version,
      timestamp: now,
      targetPath: depInfo.dist.fullPath
    };
    //
    // Remove name from the installed package path and save fyn link file there
    //
    const nameX = vdir.lastIndexOf(depInfo.name);
    const vdirNoName = vdir.substring(0, nameX);
    Fs.writeFileSync(Path.join(vdirNoName, FYN_LINK_JSON), JSON.stringify(vFynLinkData, null, 2));
    //
    // create symlink for for app's installed node_modules to the target
    //
    rimraf.sync(vdir);
    Fs.symlinkSync(depInfo.dir, vdir);

    //
    // take depInfo.json._depResolutions and save it to fyn link file
    //
    const targetNmDir = Path.join(depInfo.dist.fullPath, "node_modules");
    mkdirp.sync(targetNmDir);
    const linkName = this._createLinkName(targetNmDir, depInfo.name);
    const linkFile = Path.join(this._fyn.linkDir, `${linkName}.json`);
    this._fyn.createDirSync(this._fyn.linkDir);
    let linkData;
    try {
      linkData = JSON.parse(Fs.readFileSync(linkFile));
    } catch (err) {
      linkData = { timestamps: {} };
    }
    linkData.targetPath = depInfo.dist.fullPath;
    linkData.timestamps[this._fyn.cwd] = now;
    linkData[this._fyn.cwd] = depInfo.json._depResolutions;
    Fs.writeFileSync(linkFile, JSON.stringify(linkData, null, 2));
    //
    // create symlink from the local package dir to the link file
    //
    const targetLinkFile = Path.join(targetNmDir, FYN_LINK_JSON);
    rimraf.sync(targetLinkFile);
    Fs.symlinkSync(linkFile, targetLinkFile);
  }

  _savePkgJson(log) {
    _.each(this.toLink, depInfo => {
      if (depInfo.local) return this._linkLocalPkg(depInfo);
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

    return Promise.resolve(this.preInstall)
      .each(depInfo => {
        if (depInfo.local) return;
        const ls = new LifecycleScripts(Object.assign({ appDir }, depInfo));
        return ls.execute(["preinstall"], true).then(() => {
          depInfo.json._fyn.preinstall = true;
        });
      })
      .then(() => {
        _.each(this.toLink, depInfo => {
          this._fyn._depResolver.resolvePeerDep(depInfo);
          this._depLinker.linkPackage(depInfo);
          if (depInfo.top) {
            this._binLinker.linkBin(depInfo);
          }
        });
        logger.debug("linking non-top dep bin");
        _.each(this.toLink, depInfo => {
          if (depInfo.deprecated && !depInfo.json._deprecated) {
            depInfo.json._deprecated = depInfo.deprecated;
            depInfo.deprecated = true;
          }
          if (!depInfo.top) {
            this._binLinker.linkBin(depInfo);
          }
        });
      })
      .then(() => this._savePkgJson())
      .then(() => this._cleanUp())
      .then(() => this._cleanBin())
      .return(this.postInstall)
      .each(depInfo => {
        const ls = new LifecycleScripts(Object.assign({ appDir }, depInfo));
        return ls
          .execute(depInfo.install, true)
          .then(() => {
            depInfo.json._fyn.install = true;
          })
          .catch(err => {
            logger.warn(chalk.yellow("ignoring npm script failure"));
          });
      })
      .then(() => this._savePkgJson(true))
      .then(() => {
        _.each(this.toLink, depInfo => {
          if (!depInfo.fromLock && depInfo.deprecated) {
            const json = depInfo.json;
            logger
              .prefix("npm")
              .warn(
                chalk.black.bgYellow("WARN") +
                  chalk.magenta(" deprecated ") +
                  `${json.name}@${json.version}: ` +
                  json._deprecated
              );
          }
        });
      })
      .then(() => this._saveLockData())
      .then(() => {
        logger.info(
          `${chalk.green("done install")}`,
          chalk.magenta(`${(Date.now() - start) / 1000}`) + "secs"
        );
      });
  }

  _gatherPkg(pkg, name) {
    _.each(pkg, (depInfo, version) => {
      if (!depInfo.json) {
        const dir = this._fyn.getInstalledPkgDir(name, version, depInfo);
        const file = Path.join(dir, "package.json");
        const str = Fs.readFileSync(file).toString();
        Object.assign(depInfo, { dir, str, json: JSON.parse(str) });
      }
      const json = depInfo.json;

      if (!json._fyn) json._fyn = {};
      const scripts = json.scripts || {};
      if (!json._fyn.preinstall && scripts.preinstall) {
        if (depInfo.preInstalled) {
          depInfo.json._fyn.preinstall = true;
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
    const outDir = this._fyn.getOutputDir();
    const binDir = Path.join(outDir, ".bin");
    const bins = Fs.readdirSync(binDir);
    for (let bx in bins) {
      const bin = bins[bx];
      const binLink = Path.join(binDir, bin);
      try {
        Fs.statSync(binLink);
      } catch (err) {
        try {
          Fs.unlinkSync(binLink);
        } catch (err) {}
      }
    }
  }

  _cleanUp(scope) {
    scope = scope || "";
    const outDir = this._fyn.getOutputDir();
    const installedPkgs = Fs.readdirSync(Path.join(outDir, scope));
    const pkgsData = this._data.getPkgsData();
    for (let ix in installedPkgs) {
      const dirName = installedPkgs[ix];
      if (dirName.startsWith(".") || dirName.startsWith("_")) continue;
      if (!scope && dirName.startsWith("@")) {
        this._cleanUp(dirName);
        continue;
      }
      const pkgName = Path.join(scope, dirName);
      const iPkg = pkgsData[pkgName];
      if (!iPkg) {
        logger.verbose("removing extraneous package", pkgName);
        this._removeDir(Path.join(outDir, pkgName));
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
      for (let vx in versions) {
        const ver = versions[vx];
        if (!pkg[ver] || pkg[ver].promoted) {
          logger.verbose("removing extraneous version", ver, "of", pkgName);
          this._removeDir(Path.join(fvDir, ver));
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
    if (!this._fyn.regenOnly) {
      const locker = this._fyn._depLocker || new PkgDepLocker();
      locker.generate(this._fyn._data);
      locker.save(Path.join(this._fyn.cwd, "fyn-lock.yaml"));
    }
  }
}

module.exports = PkgInstaller;
