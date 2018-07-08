"use strict";

/* eslint-disable global-require */

const Fs = require("./util/file-ops");
const logger = require("./logger");
const PkgBinLinkerBase = require("./pkg-bin-linker-base");

//
// Look at each promoted package and link their bin
//

class PkgBinLinker extends PkgBinLinkerBase {
  constructor(options) {
    super(options);
  }

  //
  // Platform specific
  //

  async _ensureGoodLink(symlink, target) {
    try {
      const existTarget = await Fs.readlink(symlink);
      if (existTarget === target) {
        return true;
      }
    } catch (err) {
      //
    }

    await this._rmBinLink(symlink);

    return false;
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

  _generateBinLink(relTarget, symlink) {
    Fs.symlinkSync(relTarget, symlink);
  }

  async _rmBinLink(symlink) {
    await this._unlinkFile(symlink);
  }

  async _readBinLinks() {
    return Fs.readdir(this._binDir);
  }
}

module.exports = PkgBinLinker;
