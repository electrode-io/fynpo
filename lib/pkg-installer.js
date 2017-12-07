"use strict";

const Path = require("path");
const Fs = require("fs");
const Promise = require("bluebird");
const _ = require("lodash");
const PkgDepLinker = require("./pkg-dep-linker");
const PkgBinLinker = require("./pkg-bin-linker");
const LifecycleScripts = require("./lifecycle-scripts");
const logger = require("./logger");

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
    _.each(this._data.pkgs, (pkg, name) => {
      this._gatherPkg(pkg, name);
    });

    logger.log("doing install");
    return this._doInstall().finally(() => {
      this.preInstall = undefined;
      this.postInstall = undefined;
      this.toLink = undefined;
    });
  }

  _savePkgJson(log) {
    _.each(this.toLink, depInfo => {
      const outputStr = `${JSON.stringify(depInfo.json, null, 2)}\n`;
      if (depInfo.str !== outputStr) {
        if (log && depInfo.linkDep) {
          const pkgJson = depInfo.json;
          logger.log(
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
    const appDir = this._fyn.cwd;

    return Promise.resolve(this.preInstall)
      .each(depInfo => {
        const ls = new LifecycleScripts(Object.assign({ appDir }, depInfo));
        return ls.execute(["preinstall"]).then(() => {
          depInfo.json._fyn.preinstall = true;
        });
      })
      .then(() => {
        _.each(this.toLink, depInfo => {
          this._depLinker.linkPackage(depInfo);
          this._binLinker.linkBin(depInfo);
        });
      })
      .then(() => this._savePkgJson())
      .return(this.postInstall)
      .each(depInfo => {
        const ls = new LifecycleScripts(Object.assign({ appDir }, depInfo));
        return ls.execute(depInfo.install).then(() => {
          depInfo.json._fyn.install = true;
        });
      })
      .then(() => this._savePkgJson(true));
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
          logger.log("adding preinstall step for", depInfo.dir);
          this.preInstall.push(depInfo);
        }
      }

      this.toLink.push(depInfo);

      if (!json._fyn.install) {
        const install = ["install", "postinstall", "postInstall"].filter(x => Boolean(scripts[x]));
        if (install.length > 0) {
          logger.log("adding install step for", depInfo.dir);
          depInfo.install = install;
          this.postInstall.push(depInfo);
        }
      }
    });
  }
}

module.exports = PkgInstaller;
