"use strict";

/* eslint-disable global-require, max-statements */

const Fs = require("./util/file-ops");
const Path = require("path");
const _ = require("lodash");
const logger = require("./logger");
const fynTil = require("./util/fyntil");

//
// Look at each promoted package and link their bin
//

class PkgBinLinkerBase {
  constructor(options) {
    this._binDir = Path.join(options.outputDir, ".bin");
    this._fyn = options.fyn;
    this._linked = {};
  }

  async clearExtras() {
    try {
      const bins = await this._readBinLinks();
      for (const sym of bins) {
        if (!this._linked[sym] && !(await this._cleanLink(sym))) {
          logger.verbose(`bin-linker: ${sym} is not linked by fyn but it's valid, ignoring.`);
        }
      }
    } catch (e) {
      logger.verbose("bin-linker: error clearing extras in .bin", e.message);
    }
  }

  async linkBin(depInfo, binList) {
    const isPrivate = Boolean(binList);
    const conflicts = {};
    const pkgDir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);

    const link = async (file, sym) => {
      const target = Path.join(pkgDir, file);
      const relTarget = Path.relative(this._binDir, target);

      if (this._linked[sym]) {
        const same = relTarget === this._linked[sym];
        logger.debug(
          `bin-linker: bin already linked ${sym} => ${this._linked[sym]}`,
          depInfo.top ? "(top)" : "(__fv)",
          same ? "(same)" : `(diff ${relTarget})`
        );
        if (!isPrivate && !same) conflicts[sym] = file;
        return;
      }

      await this._mkBinDir();
      const symlink = Path.join(this._binDir, sym);

      if (!(await this._ensureGoodLink(symlink, relTarget))) {
        logger.debug(`bin-linker: symlinking ${symlink} => ${relTarget} for ${pkgDir}`);
        try {
          this._generateBinLink(relTarget, symlink);
        } catch (err) {
          logger.error(`bin-linker: symlink failed ${symlink} => ${relTarget}`, err.message);
        }
      }

      this._chmod(target);
      logger.debug(`bin-linker: setting linked for ${sym} => ${relTarget}`);
      this._linked[sym] = relTarget;
    };

    if (!binList) {
      binList = depInfo.json.bin;
    }

    if (binList) {
      if (_.isObject(binList)) {
        for (const sym in binList) {
          await link(binList[sym], sym);
        }
      } else {
        await link(binList, Path.basename(depInfo.json.name));
      }
    }

    if (!_.isEmpty(conflicts)) {
      depInfo.privateBin = conflicts;
      logger.debug(`bin-linker: symlinking private bin for ${pkgDir}`);
      await this._linkPrivateBin(await fynTil.createSubNodeModulesDir(pkgDir), depInfo, conflicts);
      logger.debug(`bin-linker: done symlinking private bin`);
    }

    return true;
  }

  async _linkPrivateBin(outputDir, depInfo, binList) {
    const binLinker = new this.constructor({ fyn: this._fyn, outputDir });
    await binLinker.linkBin(depInfo, binList);
  }

  async _unlinkFile(symlink) {
    try {
      await Fs.unlink(symlink);
    } catch (e) {
      //
    }
  }

  async _cleanLink(sym) {
    const symlink = Path.join(this._binDir, sym);

    try {
      await Fs.access(symlink);
      return false;
    } catch (e) {
      //
    }

    await this._rmBinLink(symlink);

    return true;
  }

  async _mkBinDir() {
    if (!(await Fs.exists(this._binDir))) {
      await Fs.$.mkdirp(this._binDir);
    }
  }

  _chmod() {}
}

module.exports = PkgBinLinkerBase;
