"use strict";

/* eslint-disable no-magic-numbers, max-statements */

const Tar = require("tar");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const Fs = require("./util/file-ops");
const logFormat = require("./util/log-format");
const xaa = require("./util/xaa");
const { LOAD_PACKAGE } = require("./log-items");

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

  async movePromotedPkgFromFV(pkg, fullOutDir) {
    logger.debug(
      "moving promoted extracted package",
      pkg.name,
      pkg.version,
      "to top level",
      fullOutDir
    );

    // first make sure top dir is clear of any other files
    // then rename node_modules/__fv_/<version>/<pkg-name>/ to node_modules/<pkg-name>

    if (await xaa.try(() => Fs.lstat(fullOutDir))) {
      await Fs.$.mkdirp(this._fyn.getExtraDir());
      await Fs.rename(fullOutDir, this._fyn.getExtraDir(`${pkg.name}-${pkg.version}`));
    }

    await Fs.rename(pkg.extracted, fullOutDir);
    // clean empty node_modules/__fv_/<version> directory
    await xaa.try(() => Fs.rmdir(this._fyn.getFvDir(pkg.version)));
  }

  async processItem(data) {
    const pkg = data.pkg;

    const fullOutDir = this._fyn.getInstalledPkgDir(pkg.name, pkg.version, pkg);

    if (pkg.extracted) {
      // do we have a copy of it in __fv_ already?
      logger.debug(
        `package ${pkg.name} ${pkg.version} has already been extracted to ${pkg.extracted}`
      );

      if (pkg.promoted) {
        await this.movePromotedPkgFromFV(pkg, fullOutDir);
      }
    } else {
      const json = await this._fyn.ensureProperPkgDir(pkg, fullOutDir);

      if (json) return json;

      await this._fyn.createPkgOutDir(fullOutDir);

      logger.debug("getting", `${pkg.name} ${pkg.version}`, "to", fullOutDir);

      const result = data.result;
      let act;
      let retrieve;
      if (typeof result === "string") {
        act = "hardlinked";
        await this._fyn.central.replicate(result, fullOutDir);
      } else {
        act = "extracted";
        await new Promise((resolve, reject) => {
          const stream = result.pipe(
            Tar.x({
              strip: 1,
              strict: true,
              C: fullOutDir
            })
          );
          stream.on("error", reject);
          stream.on("close", resolve);
        });
      }

      const msg = logFormat.pkgPath(pkg.name, fullOutDir);
      logger.updateItem(LOAD_PACKAGE, `${act} ${msg}`);
    }

    return this._fyn.readPkgJson(pkg, fullOutDir);
  }
}

module.exports = PkgDistExtractor;
