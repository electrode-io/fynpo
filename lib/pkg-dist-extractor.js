"use strict";

/* eslint-disable no-magic-numbers */

const Tar = require("tar");
const Path = require("path");
const Fs = require("fs");
const Promise = require("bluebird");
const _ = require("lodash");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const readdir = Promise.promisify(Fs.readdir);
const rename = Promise.promisify(Fs.rename);
const mkdirp = Promise.promisify(require("mkdirp"));
const rimraf = Promise.promisify(require("rimraf"));
const rmdir = Promise.promisify(Fs.rmdir);

class PkgDistExtractor {
  constructor(options) {
    this._promiseQ = new PromiseQueue({
      stopOnError: true,
      processItem: (x, id) => this.processItem(x, id)
    });
    this._fyn = options.fyn;
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("failItem", x => logger.log("dist extractor failed item", x.error));
  }

  addPkgDist(data) {
    this._promiseQ.addItem(data);
  }

  wait() {
    return this._promiseQ.wait();
  }

  done(data) {
    logger.log("done dist extracting", data.totalTime / 1000);
  }

  processItem(data) {
    const pkg = data.pkg;

    const fullOutDir = this._fyn.getInstalledPkgDir(pkg.name, pkg.version, pkg);

    const clearOutDir = dir => {
      return readdir(dir)
        .then(files => files.filter(x => x !== "__fv_"))
        .each(f => rimraf(Path.join(fullOutDir, f)));
    };

    const createOutDir = dir => {
      return mkdirp(dir)
        .catch(err => {
          // exist but is not a dir? delete it and mkdir.
          return err.code === "EEXIST" && rimraf(dir).then(() => mkdirp(dir));
        })
        .then(r => {
          // dir already exist? clear it.
          return r === null && clearOutDir(dir);
        });
    };

    // do we have a copy of it in __fv_ already?
    if (pkg.extracted) {
      logger.log("package", pkg.name, pkg.version, "has already been extracted to", pkg.extracted);
      if (!pkg.promoted) {
        return this._fyn.readPkgJson(pkg);
      } else {
        // just move it to top dir
        // first make sure top dir is clear of any other files
        // then move it
        // delete __fv_/<version> dir

        // Since it's been promoted, we know fullOutDir doesn't have __fv_
        return clearOutDir(fullOutDir).then(() => {
          return readdir(pkg.extracted)
            .each(f => rename(Path.join(pkg.extracted, f), Path.join(fullOutDir, f)))
            .then(() => rmdir(pkg.extracted).catch(_.noop))
            .then(() => rmdir(Path.join(fullOutDir, "__fv_")).catch(_.noop))
            .then(() => this._fyn.readPkgJson(pkg));
        });
      }
    } else {
      return this._fyn.readPkgJson(pkg).catch(() =>
        createOutDir(fullOutDir)
          .then(() => {
            logger.log("extracting", data.fullTgzFile);
            return Tar.x({
              file: data.fullTgzFile,
              strip: 1,
              strict: true,
              C: fullOutDir
            });
          })
          .then(() => {
            logger.log(data.fullTgzFile, "extracted to", fullOutDir);
          })
          .then(() => this._fyn.readPkgJson(pkg))
      );
    }
  }
}

module.exports = PkgDistExtractor;
