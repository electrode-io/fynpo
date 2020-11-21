"use strict";

/* eslint-disable global-require */

const Fs = require("./util/file-ops");
const logger = require("./logger");
const PkgBinLinkerBase = require("./pkg-bin-linker-base");

//
// Look at each promoted package and link their bin to node_modules/.bin
// TODO: only do this for packages in package.json [*]dependencies
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

  async _chmod(target) {
    try {
      await Fs.access(target, Fs.constants.X_OK);
      return;
    } catch (e) {
      //
    }

    try {
      await Fs.chmod(target, "0755");
    } catch (err) {
      logger.error(`bin-linker: chmod on ${target} failed`, err.message);
    }
  }

  async _generateBinLink(relTarget, symlink) {
    return Fs.symlink(relTarget, symlink);
  }

  async _rmBinLink(symlink) {
    await this._unlinkFile(symlink);
  }

  async _readBinLinks() {
    return Fs.readdir(this._binDir);
  }
}

module.exports = PkgBinLinker;
