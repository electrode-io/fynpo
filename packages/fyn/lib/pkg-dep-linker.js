"use strict";

/* eslint-disable no-magic-numbers */

const Path = require("path");
const Fs = require("fs");
const _ = require("lodash");
const logger = require("./logger");

/*
 * generate data to link all packages' resolution
 * information.
 */

class PkgDepLinker {
  constructor(options) {
    this._fyn = options.fyn;
    this._data = options.data || options.fyn._data;
  }

  // insert _depResolutions into package.json of all versions of package `name`
  _linkPkg(name) {
    const pkg = this._data.pkgs[name];
    Object.keys(pkg).forEach(version => {
      // pkg[version].linkResolution();
      this.linkResolution(name, version, pkg[version]);
    });
  }

  // insert _depResolutions into package.json of package `name`@`version`
  linkResolution(name, version, pkg) {
    // console.log("linking", name, version, pkg, pkg.promoted);
    const pkgDir = this._fyn.getInstalledPkgDir(name, version, pkg);
    logger.log("loading package.json from", pkgDir);
    const pkgJsonFile = Path.join(pkgDir, "package.json");
    this.linkPackageFile(pkgJsonFile);
  }

  link() {
    this._data.cleanLinked();
    // go through each package and insert
    // _depResolutions into its package.json
    Object.keys(this._data.pkgs).forEach(name => this._linkPkg(name));
    this.linkApp();
  }

  // link top level package
  linkApp() {
    const resData = this._data.res;
    const depRes = {};

    _.each(["dep", "dev", "opt"], section => {
      _.each(resData[section], (resInfo, depName) => {
        depRes[depName] = Object.assign({}, resInfo);
      });
    });

    Fs.writeFileSync(
      Path.join(this._fyn.getOutputDir(), "__dep_resolution.json"),
      `${JSON.stringify(depRes, null, 2)}\n`
    );
  }

  linkPackage(pkgJson) {
    logger.log("getting res data for", pkgJson.name, pkgJson.version);
    const resData = this._data.pkgs[pkgJson.name][pkgJson.version].res;
    if (_.isEmpty(resData)) return false;

    const dep = resData.dep;
    const depRes = (pkgJson._depResolutions = {});
    _.each(dep, (resInfo, depName) => {
      depRes[depName] = { resolved: resInfo.resolved };
    });
    logger.log("linking", pkgJson.name);
    return true;
  }

  linkPackageFile(pkgJsonFile) {
    const pkgJsonStr = Fs.readFileSync(pkgJsonFile).toString();
    const pkgJson = JSON.parse(pkgJsonStr);
    if (this.linkPackage(pkgJson)) {
      Fs.writeFileSync(pkgJsonFile, `${JSON.stringify(pkgJson, null, 2)}\n`);
    }
  }
}

module.exports = PkgDepLinker;
