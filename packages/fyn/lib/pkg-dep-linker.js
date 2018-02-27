"use strict";

/* eslint-disable no-magic-numbers,max-statements */

const Crypto = require("crypto");
const Path = require("path");
const Fs = require("fs");
const _ = require("lodash");
const rimraf = require("rimraf");
const mkdirp = require("mkdirp");
const logger = require("./logger");
const logFormat = require("./util/log-format");

const FYN_RESOLUTIONS_JSON = "__fyn_resolutions__.json";
const FYN_LINK_JSON = "__fyn_link__.json";
const FYN_IGNORE_FILE = "__fyn_ignore__";

const isWin32 = process.platform === "win32";
const DIR_SYMLINK_TYPE = isWin32 ? "junction" : "dir";

const makeFynLinkFName = pkgName => {
  return `__fyn_link_${pkgName}__.json`;
};

const createFileSymlink = (linkName, targetName) => {
  if (isWin32) {
    // Windows symlink require admin permission
    // And Junction is only for directories
    // Too bad, just make a hard link.
    Fs.linkSync(targetName, linkName);
  } else {
    Fs.symlinkSync(targetName, linkName);
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
  linkApp(resData, fynFo, outputDir) {
    const depRes = {};

    _.each(["dep", "dev", "opt"], section => {
      _.each(resData[section], (resInfo, depName) => {
        depRes[depName] = Object.assign({}, resInfo);
      });
    });

    depRes._fynFo = fynFo;

    Fs.writeFileSync(
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

  addSubNodeModules(depInfo, fvDeps) {
    if (fvDeps.length <= 0) return;

    if (depInfo.local) {
      logger.warn(
        `locally linked module ${logFormat.pkgId(
          depInfo
        )} require flat-module for nested dependencies`
      );
      return;
    }

    const subjectDir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);
    const subjectNmDir = Path.join(subjectDir, "node_modules");
    mkdirp.sync(subjectNmDir);
    const fynIgnoreFile = Path.join(subjectNmDir, FYN_IGNORE_FILE);
    if (!Fs.existsSync(fynIgnoreFile)) {
      Fs.writeFileSync(fynIgnoreFile, "");
    }

    const getDirForScope = name => {
      if (name.startsWith("@") && name.indexOf("/") > 0) {
        const splits = name.split("/");
        return { dir: Path.join(subjectNmDir, splits[0]), name: splits[1] };
      }
      return { dir: subjectNmDir, name };
    };

    fvDeps.forEach(di => {
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
        if (!Fs.existsSync(scope.dir)) {
          Fs.mkdirSync(scope.dir);
        }
        const existTarget = this.validateExistSymlink(symlinkName, relLinkPath);
        if (!existTarget) {
          Fs.symlinkSync(relLinkPath, symlinkName, DIR_SYMLINK_TYPE);
        }
      } catch (e) {
        logger.warn("symlink sub node_modules failed", e.message);
      }
    });
  }

  addPackageRes(depInfo) {
    const pkgJson = depInfo.json;
    if (depInfo.promoted) pkgJson._flatVersion = pkgJson.version;

    const depRes = (pkgJson._depResolutions = {});

    const resData = depInfo.res;
    if (_.isEmpty(resData) || !resData.dep) return true;

    const pkgs = this._fyn._data.getPkgsData();
    const fvDeps = [];

    _.each(["dep", "opt"], section => {
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
          depRes[depName] = { resolved: depPkg.resolved };
        });
    });

    this.addSubNodeModules(depInfo, fvDeps);

    return true;
  }

  linkPackage(depInfo) {
    depInfo.linkDep = this.addPackageRes(depInfo);
    return depInfo.linkDep;
  }

  validateExistSymlink(symlinkDir, targetPath) {
    let existTarget;
    //
    // Check if the dir already exist and try to read it as a symlink
    //
    try {
      existTarget = Fs.readlinkSync(symlinkDir);
    } catch (e) {
      existTarget = e.code !== "ENOENT";
    }

    // If it exist but doesn't match targetDir
    if (existTarget && existTarget !== targetPath) {
      // remove exist target so a new one can be created
      existTarget = false;
      try {
        // try to unlink it as a symlink/file first
        Fs.unlinkSync(symlinkDir);
      } catch (e) {
        // else remove the directory
        rimraf.sync(symlinkDir);
      }
    }

    return existTarget;
  }

  //
  // Creates the package's directory under node_modules/__fv_/<version>
  // and make a symlink from there to the actual directory of the local package.
  //
  linkLocalPackage(fvDir, targetPath) {
    const existTarget = this.validateExistSymlink(fvDir, targetPath);

    //
    // create symlink from app's node_modules/__fv_/<version>/<pkg-name> to the target
    //
    if (!existTarget) {
      //
      // create the directory one level up so the actual package name or the second part
      // of it if it's scoped can be a symlinked to the local package's directory.
      //
      const vdirOneUp = Path.join(fvDir, "..");
      this._fyn.createPkgOutDirSync(vdirOneUp);
      if (Path.isAbsolute(targetPath)) {
        targetPath = Path.relative(vdirOneUp, targetPath);
      }
      Fs.symlinkSync(targetPath, fvDir, DIR_SYMLINK_TYPE);
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
  saveLocalPackageFynLink(depInfo) {
    if (!depInfo.local) return;

    //
    // take depInfo.json._depResolutions and save it to fyn link file
    //
    const targetPath = depInfo.dist.fullPath;
    const targetNmDir = Path.join(targetPath, "node_modules");
    mkdirp.sync(targetNmDir);
    // save link file for target module to FYN_DIR/links
    const fynLinkId = this._createLinkName(targetNmDir, depInfo.name);
    const fynLinkFile = Path.join(this._fyn.linkDir, `${fynLinkId}.json`);
    this._fyn.createDirSync(this._fyn.linkDir);
    const fynLinkData = this._fyn.readJson(fynLinkFile, { timestamps: {} });
    fynLinkData.realFynLinkPath = fynLinkFile;
    fynLinkData.targetPath = targetPath;
    fynLinkData.timestamps[this._fyn.cwd] = Date.now();
    fynLinkData[this._fyn.cwd] = _.pick(depInfo.json, "_depResolutions");
    Fs.writeFileSync(fynLinkFile, `${JSON.stringify(fynLinkData, null, 2)}\n`);
    //
    // create symlink from the local package dir to the link file
    //
    const symlinkFile = Path.join(targetNmDir, FYN_LINK_JSON);
    rimraf.sync(symlinkFile);
    createFileSymlink(symlinkFile, fynLinkFile);

    //
    // Save fynlink data for the app
    //
    Fs.writeFileSync(depInfo.nmFynLinkName, JSON.stringify(depInfo.fynLinkData, null, 2));
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
    const nmFynLinkName = Path.join(vdirNoName, makeFynLinkFName(depInfo.name));
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
