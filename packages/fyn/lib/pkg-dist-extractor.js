"use strict";

/* eslint-disable no-magic-numbers */

const Tar = require("tar");
const Fs = require("fs");
const Promise = require("bluebird");
const _ = require("lodash");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const rename = Promise.promisify(Fs.rename);
const rmdir = Promise.promisify(Fs.rmdir);
const logFormat = require("./util/log-format");
const mkdirp = require("mkdirp");
const mkdirpAsync = Promise.promisify(mkdirp);
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
    this._promiseQ.on("failItem", x =>
      logger.error("dist extractor failed item", _.get(x, "item.fullTgzFile"), x.error)
    );
  }

  addPkgDist(data) {
    this._promiseQ.addItem(data);
  }

  wait() {
    return this._promiseQ.wait();
  }

  done(data) {
    logger.debug("done dist extracting", data.totalTime / 1000);
  }

  movePromotedPkgFromFV(pkg, fullOutDir) {
    logger.debug(
      "moving promoted extracted package",
      pkg.name,
      pkg.version,
      "to top level",
      fullOutDir
    );

    // first make sure top dir is clear of any other files
    // then rename node_modules/__fv_/<version>/<pkg-name>/ to node_modules/<pkg-name>

    return Promise.try(
      () =>
        Fs.existsSync(fullOutDir) &&
        mkdirpAsync(this._fyn.getExtraDir()).then(() =>
          rename(fullOutDir, this._fyn.getExtraDir(`${pkg.name}-${pkg.version}`))
        )
    )
      .then(() => rename(pkg.extracted, fullOutDir))
      .then(() => {
        // clean empty node_modules/__fv_/<version> directory
        return rmdir(this._fyn.getFvDir(pkg.version)).catch(_.noop);
      });
  }

  processItem(data) {
    const pkg = data.pkg;

    const fullOutDir = this._fyn.getInstalledPkgDir(pkg.name, pkg.version, pkg);

    if (pkg.extracted) {
      // do we have a copy of it in __fv_ already?
      logger.debug(
        "package",
        pkg.name,
        pkg.version,
        "has already been extracted to",
        pkg.extracted
      );
      if (!pkg.promoted) {
        return this._fyn.readPkgJson(pkg);
      } else {
        return this.movePromotedPkgFromFV(pkg, fullOutDir).then(() => this._fyn.readPkgJson(pkg));
      }
    } else {
      return this._fyn.readPkgJson(pkg).catch(() =>
        this._fyn
          .createPkgOutDir(fullOutDir)
          .then(() => {
            logger.debug("extracting", data.fullTgzFile, "to", fullOutDir);
            return Tar.x({
              file: data.fullTgzFile,
              strip: 1,
              strict: true,
              C: fullOutDir
            });
          })
          .then(() => {
            const msg = logFormat.pkgPath(pkg.name, fullOutDir);
            logger.updateItem(LOAD_PACKAGE, `extracted ${msg}`);
          })
          .then(() => this._fyn.readPkgJson(pkg))
      );
    }
  }
}

module.exports = PkgDistExtractor;
