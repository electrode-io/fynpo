"use strict";

/* eslint-disable no-magic-numbers,max-statements,prefer-template */

const Crypto = require("crypto");
const Path = require("path");
const Fs = require("./util/file-ops");
const _ = require("lodash");
const logger = require("./logger");
const logFormat = require("./util/log-format");
const fynTil = require("./util/fyntil");

const FYN_RESOLUTIONS_JSON = "__fyn_resolutions__.json";
const FYN_LINK_JSON = "__fyn_link__.json";

const isWin32 = process.platform === "win32";
const DIR_SYMLINK_TYPE = isWin32 ? "junction" : "dir";

const createFileSymlink = async (linkName, targetName) => {
  if (isWin32) {
    // Windows symlink require admin permission
    // And Junction is only for directories
    // Too bad, just make a hard link.
    await Fs.link(targetName, linkName);
  } else {
    await Fs.symlink(targetName, linkName);
  }
};

/*
 * generate data to link all packages' resolution
 * information.
 */

class PkgDepLinker {
  constructor({ fyn }) {
    this._fyn = fyn;
  }

  // link top level package
  async linkApp(resData, fynFo, outputDir) {
    const depRes = {};

    _.each(["dep", "dev", "opt"], section => {
      _.each(resData[section], (resInfo, depName) => {
        depRes[depName] = Object.assign({}, resInfo);
      });
    });

    depRes._fynFo = fynFo;

    await Fs.writeFile(
      Path.join(outputDir, FYN_RESOLUTIONS_JSON),
      `${JSON.stringify(depRes, null, 2)}\n`
    );
  }

  readAppRes(outputDir) {
    try {
      return JSON.parse(Fs.readFileSync(Path.join(outputDir, FYN_RESOLUTIONS_JSON)));
    } catch (e) {
      return { _fynFo: {} };
    }
  }

  async addSubNodeModules(depInfo, fvDeps) {
    if (fvDeps.length <= 0) return;

    if (depInfo.local) {
      this._fyn.addLocalPkgWithNestedDep(depInfo);
      return;
    }

    const subjectNmDir = await fynTil.createSubNodeModulesDir(
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
        const existTarget = await this.validateExistSymlink(symlinkName, relLinkPath);
        if (!existTarget) {
          await Fs.symlink(relLinkPath, symlinkName, DIR_SYMLINK_TYPE);
        }
      } catch (e) {
        logger.warn("symlink sub node_modules failed", e.message);
      }
    }
  }

  async addPackageRes(depInfo) {
    const pkgJson = depInfo.json;
    if (depInfo.promoted) pkgJson._flatVersion = pkgJson.version;

    const depRes = (pkgJson._depResolutions = {});

    const resData = depInfo.res;
    if (_.isEmpty(resData) || !resData.dep) return true;

    const pkgs = this._fyn._data.getPkgsData();
    const fvDeps = [];

    _.each(["dep", "per", "opt"], section => {
      const dep = resData[section] || {};

      Object.keys(dep)
        .sort()
        .forEach(depName => {
          const depPkg = dep[depName];
          // depends on a package that's not promoted to top level.
          // need to create a node_modules dir within and add a symlink
          // there to the depPkg.
          const pkgInfo = pkgs[depName][depPkg.resolved];
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

  async validateExistSymlink(symlinkDir, targetPath) {
    let existTarget;
    //
    // Check if the dir already exist and try to read it as a symlink
    //
    try {
      existTarget = await Fs.readlink(symlinkDir);
      if (DIR_SYMLINK_TYPE === "junction" && !Path.isAbsolute(targetPath)) {
        targetPath = Path.join(symlinkDir, "..", targetPath) + "\\";
      }
    } catch (e) {
      existTarget = e.code !== "ENOENT";
    }

    // If it exist but doesn't match targetDir
    if (existTarget && existTarget !== targetPath) {
      logger.debug("local link exist", existTarget, "not match new one", targetPath);
      // remove exist target so a new one can be created
      existTarget = false;
      try {
        // try to unlink it as a symlink/file first
        await Fs.unlink(symlinkDir);
      } catch (e) {
        // else remove the directory
        await Fs.$.rimraf(symlinkDir);
      }
    } else {
      logger.debug("local link existTarget", existTarget, "match new target", targetPath);
    }

    return existTarget;
  }

  //
  // Creates the package's directory under node_modules/__fv_/<version>
  // and make a symlink from there to the actual directory of the local package.
  //
  async linkLocalPackage(fvDir, targetPath) {
    const vdirOneUp = Path.join(fvDir, "..");

    if (Path.isAbsolute(targetPath)) {
      targetPath = Path.relative(vdirOneUp, targetPath);
    }

    const existTarget = await this.validateExistSymlink(fvDir, targetPath);

    //
    // create symlink from app's node_modules/__fv_/<version>/<pkg-name> to the target
    //
    if (!existTarget) {
      //
      // create the directory one level up so the actual package name or the second part
      // of it if it's scoped can be a symlinked to the local package's directory.
      //
      await this._fyn.createPkgOutDir(vdirOneUp, true);
      logger.debug("linking local package", fvDir, "to", targetPath);
      await Fs.symlink(targetPath, fvDir, DIR_SYMLINK_TYPE);
    } else {
      logger.debug("linking local package", fvDir, "already exist", existTarget);
    }
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
  async saveLocalPackageFynLink(depInfo) {
    if (!depInfo.local) return;

    //
    // take depInfo.json._depResolutions and save it to fyn link file
    //
    const targetPath = depInfo.dist.fullPath;
    const targetNmDir = Path.join(targetPath, "node_modules");
    await Fs.$.mkdirp(targetNmDir);
    // save link file for target module to FYN_DIR/links
    const fynLinkId = this._createLinkName(targetNmDir, depInfo.name);
    const fynLinkFile = Path.join(this._fyn.linkDir, `${fynLinkId}.json`);
    await this._fyn.createDir(this._fyn.linkDir);
    const fynLinkData = this._fyn.readJson(fynLinkFile, { timestamps: {} });
    fynLinkData.realFynLinkPath = fynLinkFile;
    fynLinkData.targetPath = targetPath;
    fynLinkData.timestamps[this._fyn.cwd] = Date.now();
    fynLinkData[this._fyn.cwd] = _.pick(depInfo.json, "_depResolutions");
    await Fs.writeFile(fynLinkFile, `${JSON.stringify(fynLinkData, null, 2)}\n`);
    //
    // create symlink from the local package dir to the link file
    //
    const symlinkFile = Path.join(targetNmDir, FYN_LINK_JSON);
    await Fs.$.rimraf(symlinkFile);
    createFileSymlink(symlinkFile, fynLinkFile);

    //
    // Save fynlink data for the app
    //
    await Fs.writeFile(depInfo.nmFynLinkName, JSON.stringify(depInfo.fynLinkData, null, 2));
  }

  //
  // Load the fynlink to a local package for the app in node_modules/__fv_
  //
  loadLocalPackageAppFynLink(depInfo, fvDir) {
    //
    // Remove name from the installed package path and save fyn link file there
    //
    const nameX = fvDir.lastIndexOf(depInfo.name);
    const vdirNoName = fvDir.substring(0, nameX);
    const nmFynLinkName = Path.join(vdirNoName, fynTil.makeFynLinkFName(depInfo.name));
    const fynLinkData = this._fyn.readJson(nmFynLinkName);
    // existing link data matches what we want to write
    if (fynLinkData.targetPath === depInfo.dist.fullPath) {
      depInfo.preinstall = fynLinkData.preinstall;
      depInfo.installed = fynLinkData.installed;
    }
    Object.assign(fynLinkData, {
      name: depInfo.name,
      version: depInfo.version,
      timestamp: Date.now(),
      targetPath: depInfo.dist.fullPath
    });
    depInfo.fynLinkData = fynLinkData;
    depInfo.nmFynLinkName = nmFynLinkName;
  }

  //
  // take a pkg dep info and load previously saved dep data into it
  //
  loadPkgDepData(depInfo) {
    // a normal installed package's dep data are saved to its package.json
    // so loading that is usually enough
    const installedDir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);

    if (!depInfo.json) {
      const fname = Path.join(installedDir, "package.json");
      depInfo.json = JSON.parse(Fs.readFileSync(fname));
    }

    // for a locally linked package, the dep data is in the __fyn_link__ JSON file
    if (depInfo.local) {
      this.loadLocalPackageAppFynLink(depInfo, installedDir);
      const targetFynlinkFile = Path.join(
        depInfo.fynLinkData.targetPath,
        "node_modules",
        FYN_LINK_JSON
      );

      const depRes = JSON.parse(Fs.readFileSync(targetFynlinkFile));
      depInfo.json._depResolutions = depRes[this._fyn.cwd]._depResolutions;
    }
  }
}

module.exports = PkgDepLinker;
