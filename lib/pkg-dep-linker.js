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
  constructor() {}

  // link top level package
  linkApp(resData, outputDir) {
    const depRes = {};

    _.each(["dep", "dev", "opt"], section => {
      _.each(resData[section], (resInfo, depName) => {
        depRes[depName] = Object.assign({}, resInfo);
      });
    });

    Fs.writeFileSync(
      Path.join(outputDir, "__fyn_resolutions__.json"),
      `${JSON.stringify(depRes, null, 2)}\n`
    );
  }

  addPackageRes(depInfo) {
    const pkgJson = depInfo.json;
    if (depInfo.promoted) pkgJson._flatVersion = pkgJson.version;

    const depRes = (pkgJson._depResolutions = {});

    const resData = depInfo.res;
    if (_.isEmpty(resData) || !resData.dep) return true;

    const dep = resData.dep;

    Object.keys(dep)
      .sort()
      .forEach(depName => {
        depRes[depName] = { resolved: dep[depName].resolved };
      });

    return true;
  }

  linkPackage(depInfo) {
    depInfo.linkDep = this.addPackageRes(depInfo);
    return depInfo.linkDep;
  }
}

module.exports = PkgDepLinker;
