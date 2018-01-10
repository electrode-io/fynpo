"use strict";

/* eslint-disable no-magic-numbers,max-statements */

const Crypto = require("crypto");
const Path = require("path");
const Fs = require("fs");
const _ = require("lodash");
const rimraf = require("rimraf");
const mkdirp = require("mkdirp");

const FYN_RESOLUTIONS_JSON = "__fyn_resolutions__.json";
const FYN_LINK_JSON = "__fyn_link__.json";

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

  addPackageRes(depInfo) {
    const pkgJson = depInfo.json;
    if (depInfo.promoted) pkgJson._flatVersion = pkgJson.version;

    const depRes = (pkgJson._depResolutions = {});

    const resData = depInfo.res;
    if (_.isEmpty(resData) || !resData.dep) return true;

    _.each(["dep", "opt"], section => {
      const dep = resData[section] || {};

      Object.keys(dep)
        .sort()
        .forEach(depName => {
          depRes[depName] = { resolved: dep[depName].resolved };
        });
    });

    return true;
  }

  linkPackage(depInfo) {
    depInfo.linkDep = this.addPackageRes(depInfo);
    return depInfo.linkDep;
  }

  //
  // Creates the package's directory under node_modules/__fv_/<version>
  // and make a symlink from there to the actual directory of the local package.
  //
  linkLocalPackage(fvDir, targetPath) {
    let existTarget;
    //
    // Check if the dir already exist and try to read it as a symlink
    //
    if (Fs.existsSync(fvDir)) {
      try {
        existTarget = Fs.readlinkSync(fvDir);
      } catch (e) {
        existTarget = true;
      }
    }

    // If it exist but doesn't match targetDir
    if (existTarget && existTarget !== targetPath) {
      // remove exist target so a new one can be created
      existTarget = false;
      try {
        // try to unlink it as a symlink/file first
        Fs.unlinkSync(fvDir);
      } catch (e) {
        // else remove the directory
        rimraf.sync(fvDir);
      }
    }

    //
    // create symlink from app's node_modules/<pkg-name>/__fv_/ to the target
    //
    if (!existTarget) {
      //
      // create the directory one level up so the actual package name or the second part
      // of it if it's scoped can be a symlinked to the local package's directory.
      //
      const vdirOneUp = Path.join(fvDir, "..");
      this._fyn.createPkgOutDirSync(vdirOneUp);
      Fs.symlinkSync(targetPath, fvDir, "dir");
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
    const linkName = this._createLinkName(targetNmDir, depInfo.name);
    const linkFile = Path.join(this._fyn.linkDir, `${linkName}.json`);
    this._fyn.createDirSync(this._fyn.linkDir);
    const linkData = this._fyn.readJson(linkFile, { timestamps: {} });
    linkData.targetPath = targetPath;
    linkData.timestamps[this._fyn.cwd] = Date.now();
    linkData[this._fyn.cwd] = depInfo.json._depResolutions;
    Fs.writeFileSync(linkFile, JSON.stringify(linkData, null, 2));
    //
    // create symlink from the local package dir to the link file
    //
    const targetLinkFile = Path.join(targetNmDir, FYN_LINK_JSON);
    rimraf.sync(targetLinkFile);
    Fs.symlinkSync(linkFile, targetLinkFile);

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
    const nmFynLinkName = Path.join(vdirNoName, FYN_LINK_JSON);
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
}

module.exports = PkgDepLinker;
