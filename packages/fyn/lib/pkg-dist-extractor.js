"use strict";

/* eslint-disable no-magic-numbers, max-statements */

const Tar = require("tar");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const logFormat = require("./util/log-format");
const { LOAD_PACKAGE } = require("./log-items");
const { retry, missPipe } = require("./util/fyntil");
const Fs = require("./util/file-ops");
const _ = require("lodash");
const Path = require("path");
const xaa = require("./util/xaa");

class PkgDistExtractor {
  constructor(options) {
    this._promiseQ = new PromiseQueue({
      concurrency: 4, // don't want to untar too many files at the same time
      stopOnError: true,
      processItem: (x, id) => this.processItem(x, id)
    });
    this._fyn = options.fyn;
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("failItem", x => logger.error("dist extractor failed item", x.error));
  }

  addPkgDist(data) {
    this._promiseQ.addItem(data);
  }

  once(evt, cb) {
    this._promiseQ.once(evt, cb);
  }

  wait() {
    return this._promiseQ.wait();
  }

  done(data) {
    logger.debug("done dist extracting", data.totalTime / 1000);
  }

  isPending() {
    return this._promiseQ.isPending;
  }

  /**
   * Process normal layout for node_modules.
   *
   * Move promoted packages to top output dir
   *
   * @param {*} pkg - package to move
   * @param {*} fullOutDir - top output dir
   */
  async movePromotedPkgFromFV(pkg, fullOutDir) {
    logger.debug(
      "moving promoted extracted package",
      pkg.name,
      pkg.version,
      "to top level",
      fullOutDir
    );

    //
    // first make sure top dir is clear of any other files
    // then rename node_modules/${FV_DIR}/<version>/<pkg-name>/ to node_modules/<pkg-name>
    //

    if (await xaa.try(() => Fs.lstat(fullOutDir))) {
      await Fs.$.mkdirp(this._fyn.getExtraDir());
      await Fs.rename(fullOutDir, this._fyn.getExtraDir(`${pkg.name}-${pkg.version}`));
    }

    const hostingDir = Path.dirname(fullOutDir);
    if (!(await xaa.try(() => Fs.stat(hostingDir)))) {
      await Fs.$.mkdirp(hostingDir);
    }

    await Fs.rename(pkg.extracted, fullOutDir);
    // clean empty node_modules/${FV_DIR}/<version> directory
    await xaa.try(() => Fs.rmdir(this._fyn.getFvDir(pkg.version)));
  }

  async processItem(data, _id, promoted) {
    const { pkg } = data;

    const promotedOpt = _.defaults({ promoted }, _.pick(pkg, "promoted"));
    const fullOutDir = this._fyn.getInstalledPkgDir(pkg.name, pkg.version, promotedOpt);

    // do we have a copy of it in FV_DIR already?
    if (pkg.extracted && pkg.extracted === fullOutDir) {
      logger.debug(
        `package ${pkg.name} ${pkg.version} has already been extracted to ${pkg.extracted}`
      );

      // if in normal layout and it's extracted to FV_DIR, but promoted, then move it to top dir
      if (this._fyn.isNormalLayout && pkg.promoted && !promotedOpt.promoted) {
        await this.movePromotedPkgFromFV(pkg, fullOutDir);
      }
    } else {
      const json = await this._fyn.ensureProperPkgDir(pkg, fullOutDir);

      if (json) {
        return json;
      }

      await this._fyn.createPkgOutDir(fullOutDir);

      const result = data.result;
      let act;
      let retrieve;

      if (typeof result === "string") {
        act = "hardlink";
        retrieve = () => {
          return this._fyn.central.replicate(result, fullOutDir);
        };
      } else {
        act = "extract";
        retrieve = () => {
          const untarStream = Tar.x({
            strip: 1,
            strict: true,
            C: fullOutDir
          });
          return missPipe(result, untarStream);
        };
      }

      logger.debug(`${act}ing ${pkg.name} ${pkg.version}`, "to", fullOutDir);

      await retrieve();

      pkg.extracted = fullOutDir;

      const msg = logFormat.pkgPath(pkg.name, fullOutDir);
      logger.updateItem(LOAD_PACKAGE, `${act}ed ${msg}`);
    }

    // when there're numerous fyn with central store enabled install happening,
    // somehow read pkg json of the newly linked package fails, but then the
    // file is there when inspect after. Basically wtf!  anyways, throw in some
    // retry, and it does occur and then succeeds.  Tested on Macbook pro High Sierra.
    let retries = 0;
    return retry(
      () => this._fyn.loadJsonForPkg(pkg, fullOutDir),
      () => {
        retries++;
        logger.warn(`retrying ${retries} reading package.json`, fullOutDir);
        return true;
      },
      5,
      10
    ).tap(pkgJson => {
      if (data.listener) {
        const listener = data.listener;
        setTimeout(() => listener.emit("done", pkgJson), 0);
      }
    });
  }
}

module.exports = PkgDistExtractor;
