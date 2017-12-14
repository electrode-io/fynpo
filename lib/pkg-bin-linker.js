"use strict";

/* eslint-disable global-require */

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const logger = require("./logger");

//
// Look at each promoted package and link their bin
//

class PkgBinLinker {
  constructor(options) {
    this._binDir = Path.join(options.outputDir, ".bin");
    if (!Fs.existsSync(this._binDir)) {
      Fs.mkdirSync(this._binDir);
    }
  }

  linkBin(depInfo) {
    if (!depInfo.promoted) return false;

    const pkgJson = depInfo.json;
    const pkgDir = depInfo.dir;

    const link = (file, sym) => {
      const symlink = Path.join(this._binDir, sym);
      if (!Fs.existsSync(symlink)) {
        const target = Path.join(pkgDir, file);
        const relTarget = Path.relative(this._binDir, target);
        logger.debug(`symlinking ${symlink} to ${relTarget} for ${pkgDir}`);
        Fs.chmodSync(target, "0755");
        Fs.symlinkSync(relTarget, symlink);
      }
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
}

module.exports = PkgBinLinker;
