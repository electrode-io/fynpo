"use strict";

/* eslint-disable global-require, max-statements, no-param-reassign */

const Fs = require("./util/file-ops");
const Path = require("path");
const _ = require("lodash");
const logger = require("./logger");

//
// Look at each promoted package and link their bin to node_modules/.bin
// TODO: only do this for packages in package.json [*]dependencies
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

  //
  // For a package's dependencies that has bin but conflicts with what's in
  // top-level .bin already, need to link them privately.
  //
  async linkDepBin(depInfo) {
    const pkgDir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);
    let binDir;
    const privatelyLinked = {};
    const pkgData = this._fyn._data.getPkgsData();

    const link = async (target, sym) => {
      if (!binDir) {
        binDir = Path.join(pkgDir, "node_modules", ".bin");
        await Fs.$.mkdirp(binDir);
      }
      const relTarget = Path.relative(binDir, target);
      // get rid of scope
      sym = _.last(sym.split("/"));

      const symlink = Path.join(binDir, sym);

      if (!(await this._ensureGoodLink(symlink, relTarget))) {
        try {
          await this._generateBinLink(relTarget, symlink);
        } catch (err) {
          logger.error(`bin-linker: symlink failed ${symlink} => ${relTarget}`, err.message);
        }
      }
    };

    const linkPrivateDep = async (depName, resolved) => {
      if (!pkgData[depName]) {
        return;
      }
      const depPkg = pkgData[depName][resolved];
      let depPkgDir;
      const json = depPkg.json;
      if (_.isEmpty(json.bin)) {
        return;
      }

      const handle = async (bin, file) => {
        if (privatelyLinked[bin]) return;
        const linked = this._linked[bin];
        if (!linked || linked.name !== depPkg.name || linked.version !== depPkg.version) {
          // it's not linked at top or something diff already linked
          // so need to privately link it for the pkg of depInfo
          privatelyLinked[bin] = true;
          if (!depPkgDir) {
            depPkgDir = this._fyn.getInstalledPkgDir(depPkg.name, depPkg.version, depPkg);
          }
          const targetFile = Path.join(depPkgDir, file);
          await link(targetFile, bin);
        }
      };

      if (_.isObject(json.bin)) {
        for (const name in json.bin) {
          await handle(name, json.bin[name]);
        }
      } else {
        await handle(json.name, json.bin);
      }
    };

    const linkDepOfSection = async depSection => {
      if (!_.isEmpty(depSection)) {
        for (const depName in depSection) {
          await linkPrivateDep(depName, depSection[depName].resolved);
        }
      }
    };

    await linkDepOfSection(depInfo.res.dep);
    await linkDepOfSection(depInfo.res.opt);
  }

  async linkBin(depInfo, binList) {
    const isPrivate = Boolean(binList);
    const conflicts = {};
    const pkgDir = this._fyn.getInstalledPkgDir(depInfo.name, depInfo.version, depInfo);

    const link = async (file, sym) => {
      const target = Path.join(pkgDir, file);
      const relTarget = Path.relative(this._binDir, target);

      // get rid of scope
      sym = _.last(sym.split("/"));
      if (this._linked[sym]) {
        const same = relTarget === this._linked[sym].relTarget;
        logger.debug(
          `bin-linker: bin already linked ${sym} => ${this._linked[sym].relTarget}`,
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
          await this._generateBinLink(relTarget, symlink);
        } catch (err) {
          logger.error(`bin-linker: symlink failed ${symlink} => ${relTarget}`, err.message);
        }
      }

      await this._chmod(target);
      logger.debug(`bin-linker: setting linked for ${sym} => ${relTarget}`);
      this._linked[sym] = {
        relTarget,
        name: depInfo.name,
        version: depInfo.version
      };
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
      const nmDir = await this._fyn.createSubNodeModulesDir(pkgDir);
      await this._linkPrivateBin(nmDir, depInfo, conflicts);
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

  async _chmod() {}
}

module.exports = PkgBinLinkerBase;
