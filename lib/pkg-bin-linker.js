"use strict";

/* eslint-disable global-require */

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const logger = require("./logger");
const mkdirp = require("mkdirp");

//
// Look at each promoted package and link their bin
//

class PkgBinLinker {
  constructor(options) {
    this._binDir = Path.join(options.outputDir, ".bin");
    this._fyn = options.fyn;
    this._linked = {};
  }

  clearExtras() {
    try {
      const bins = Fs.readdirSync(this._binDir);
      for (const sym of bins) {
        if (!this._linked[sym] && !this._cleanLink(sym)) {
          logger.verbose(`bin-linker: ${sym} is not linked by fyn but it's valid, ignoring.`);
        }
      }
    } catch (e) {
      logger.error("bin-linker: clear extra bin error", e.message);
    }
  }

  linkBin(depInfo) {
    const pkgJson = depInfo.json;
    const pkgDir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);

    const link = (file, sym) => {
      if (this._linked[sym]) {
        logger.verbose(`bin-linker: bin ${sym} already linked to ${this._linked[sym]}`);
        return;
      }

      this._mkBinDir();

      const symlink = Path.join(this._binDir, sym);

      const target = Path.join(pkgDir, file);
      const relTarget = Path.relative(this._binDir, target);

      if (!this._ensureGoodLink(symlink, relTarget)) {
        logger.debug(`bin-linker: symlinking ${symlink} to ${relTarget} for ${pkgDir}`);
        try {
          Fs.symlinkSync(relTarget, symlink);
        } catch (err) {
          logger.error(`bin-linker: symlink ${symlink} => ${relTarget} failed`, err.message);
        }
      }

      this._chmod(target);
      this._linked[sym] = relTarget;
    };

    if (pkgJson.bin) {
      if (_.isObject(pkgJson.bin)) {
        _.each(pkgJson.bin, link);
      } else {
        link(pkgJson.bin, Path.basename(pkgJson.name));
      }
    }

    return true;
  }

  _cleanLink(sym) {
    const symlink = Path.join(this._binDir, sym);

    try {
      Fs.accessSync(symlink);
      return false;
    } catch (e) {
      //
    }

    this._rmLink(symlink);
    return true;
  }

  _mkBinDir() {
    if (!Fs.existsSync(this._binDir)) {
      mkdirp.sync(this._binDir);
    }
  }

  _chmod(target) {
    try {
      Fs.accessSync(target, Fs.constants.X_OK);
      return;
    } catch (e) {
      //
    }

    try {
      Fs.chmodSync(target, "0755");
    } catch (err) {
      logger.error(`bin-linker: chmod on ${target} failed`, err.message);
    }
  }

  _rmLink(symlink) {
    try {
      Fs.unlinkSync(symlink);
    } catch (e) {
      //
    }
  }

  _ensureGoodLink(symlink, target) {
    try {
      const existTarget = Fs.readlinkSync(symlink);
      if (existTarget === target) {
        return true;
      }
    } catch (err) {
      //
    }

    this._rmLink(symlink);

    return false;
  }
}

module.exports = PkgBinLinker;
