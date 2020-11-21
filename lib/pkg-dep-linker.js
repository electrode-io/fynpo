"use strict";

/* eslint-disable no-magic-numbers,max-statements,prefer-template */

const Crypto = require("crypto");
const Path = require("path");
const Fs = require("./util/file-ops");
const _ = require("lodash");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const fynTil = require("./util/fyntil");

/*
 * generate data to link all packages' resolution
 * information.
 */

class PkgDepLinker {
  constructor({ fyn }) {
    this._fyn = fyn;
  }

  makeAppFynRes(resData, fynFo) {
    const depRes = {};

    _.each(["dep", "dev", "opt", "devopt"], section => {
      _.each(resData[section], (resInfo, depName) => {
        depRes[depName] = Object.assign({}, resInfo);
      });
    });

    depRes._fynFo = fynFo;

    return depRes;
  }

  // link top level package
  /*deprecated*/ async linkAppFynRes(/*resData, fynFo, outputDir*/) {
    throw new Error("fyn resolutions deprecated.");
    // const fynResFile = Path.join(outputDir, FYN_RESOLUTIONS_JSON);
    // if (!this._fyn.flatMeta) {
    //   if (await Fs.exists(fynResFile)) {
    //     await xaa.try(() => Fs.unlink(fynResFile));
    //   }
    //   return;
    // }
    // const depRes = this.makeAppFynRes(resData, fynFo);
    // await Fs.writeFile(fynResFile, `${JSON.stringify(depRes, null, 2)}\n`);
  }

  /*deprecated*/ async readAppFynRes(/*outputDir*/) {
    throw new Error("fyn resolutions deprecated.");
    // const emptyRes = { _fynFo: {} };

    // if (this._fyn.flatMeta) {
    //   return await xaa.try(
    //     async () => JSON.parse(await Fs.readFile(Path.join(outputDir, FYN_RESOLUTIONS_JSON))),
    //     emptyRes
    //   );
    // }

    // return emptyRes;
  }

  async addSubNodeModules(depInfo, fvDeps) {
    if (fvDeps.length <= 0) return;

    if (depInfo.local && depInfo.local === "sym1") {
      this._fyn.addLocalPkgWithNestedDep(depInfo);
      return;
    }

    const subjectNmDir = await this._fyn.createSubNodeModulesDir(
      this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo)
    );

    const getDirForScope = name => {
      if (name.startsWith("@") && name.indexOf("/") > 0) {
        const splits = name.split("/");
        return { dir: Path.join(subjectNmDir, splits[0]), name: splits[1] };
      }
      return { dir: subjectNmDir, name };
    };

    for (const di of fvDeps) {
      const diDir = this._fyn.getInstalledPkgDir(di.name, di.version, di);
      const scope = getDirForScope(di.name);
      const relLinkPath = Path.relative(scope.dir, diDir);
      logger.debug(
        "pkg",
        logFormat.pkgId(depInfo),
        "need sub node_modules for",
        logFormat.pkgId(di),
        "to",
        relLinkPath
      );
      try {
        const symlinkName = Path.join(scope.dir, scope.name);
        if (!(await Fs.exists(scope.dir))) {
          await Fs.mkdir(scope.dir);
        }
        const existTarget = await fynTil.validateExistSymlink(symlinkName, relLinkPath);
        if (!existTarget) {
          await fynTil.symlinkDir(symlinkName, relLinkPath);
        }
      } catch (e) {
        logger.warn("symlink sub node_modules failed", e.message);
      }
    }
  }

  async addPackageRes(depInfo) {
    const depRes = {}; //  (pkgJson._depResolutions = {});

    const resData = depInfo.res;
    // TODO: check existing node_modules and do clean-up as necessary
    if (_.isEmpty(resData)) return true;

    const pkgs = this._fyn._data.getPkgsData();
    const fvDeps = [];

    _.each(["dep", "per", "opt"], section => {
      const dep = resData[section] || {};

      Object.keys(dep)
        .sort()
        .forEach(depName => {
          const depPkg = dep[depName];
          // depends on a package that's not promoted to flatten top level.
          // need to create a node_modules dir within and add a symlink
          // there to the depPkg.
          const pkgInfo = pkgs[depName][depPkg.resolved];
          // TODO: outdated lock data could cause pkgInfo to be undefined
          if (!pkgInfo) return;
          if (!pkgInfo.promoted) {
            fvDeps.push(pkgInfo);
          }
          if (depRes[depName]) {
            depRes[depName].type += `;${section}`;
          } else {
            depRes[depName] = { resolved: depPkg.resolved, type: section };
          }
        });
    });

    await this.addSubNodeModules(depInfo, fvDeps);

    return true;
  }

  async linkPackage(depInfo) {
    depInfo.linkDep = await this.addPackageRes(depInfo);
    return depInfo.linkDep;
  }

  //
  // Use symlink to connect fynlocal packages.
  // First creates the package's directory under node_modules/${FV_DIR/<version>
  // and then make a symlink from there to the actual directory of the local package.
  //
  /*deprecated*/ async symlinkLocalPackage(/*fvDir, targetPath*/) {
    throw new Error("symlinking local package deprecated, only hard linking.");
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

  //
  // Save fynlink data of a local package for the package and the app.
  // - For the local package, it's saved in <fyndir>/links with filename as
  // <package_name>-<sha1 of targetNmDir & name>.json
  // and then make a symlink in its node_modules directory to the file
  // - For the app, it's saved with info setup in loadLocalPackageAppFynLink
  //
  /*deprecated*/ async saveLocalPackageFynLink(/*depInfo*/) {
    throw new Error("symlink local package is deprecated, only hard linking.");
  }

  //
  // Load the fynlink to a local package for the app in node_modules/${FV_DIR}
  //
  /*deprecated*/ async loadLocalPackageAppFynLink(/*depInfo, fvDir*/) {
    throw new Error("symlink local package is deprecated, only hard linking.");
  }

  //
  // Take a pkg dep info and load previously saved dep data into it
  // Used by fyn stat command
  //
  async loadPkgDepData(depInfo) {
    // a normal installed package's dep data are saved to its package.json
    // so loading that is usually enough
    const installedDir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);

    if (!depInfo.json) {
      const fname = Path.join(installedDir, "package.json");
      depInfo.json = JSON.parse(await Fs.readFile(fname));
    }

    // for a locally linked package, the dep data is in the __fyn_link__ JSON file
    if (depInfo.local === "sym") {
      throw new Error("sym linking local package deprecated. only hard linking.");

      // await this.loadLocalPackageAppFynLink(depInfo, installedDir);
      // const targetFynlinkFile = Path.join(
      //   depInfo.fynLinkData.targetPath,
      //   "node_modules",
      //   FYN_LINK_JSON
      // );

      // const depRes = JSON.parse(await Fs.readFile(targetFynlinkFile));
      // depInfo.json._depResolutions = depRes[this._fyn.cwd]._depResolutions;
    }
  }
}

module.exports = PkgDepLinker;
