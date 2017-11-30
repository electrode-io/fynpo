"use strict";

/* eslint-disable no-magic-numbers */

const Tar = require("tar");
const Path = require("path");
const Fs = require("fs");
const Promise = require("bluebird");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const readFile = Promise.promisify(Fs.readFile);
const readdir = Promise.promisify(Fs.readdir);
const rename = Promise.promisify(Fs.rename);
const mkdirp = Promise.promisify(require("mkdirp"));
const rimraf = Promise.promisify(require("rimraf"));
const assert = require("assert");

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
    const pkgJsonFname = Path.join(fullOutDir, "package.json");

    const readPkgJson = () => {
      return readFile(pkgJsonFname)
        .then(JSON.parse)
        .tap(x => {
          assert(
            x && x.name === pkg.name && x.version === pkg.version,
            `Pkg in ${fullOutDir} ${x.name}@${x.version} doesn't match ${pkg.name}@${pkg.version}`
          );
        });
    };

    // do we have a copy of it in __fv_ already?
    if (pkg.extracted) {
      logger.log("package", pkg.name, pkg.version, "has already been extracted to", pkg.extracted);
      if (!pkg.promoted) {
        return readPkgJson();
      } else {
        // just move it to top dir
        // first make sure top dir is clear of any other files
        // then move it
        // delete __fv_/<version> dir

        // Since it's been promoted, we know fullOutDir doesn't have __fv_
        const fvDir = Path.join(fullOutDir, "__fv_");
        return mkdirp(fullOutDir).then(() => {
          return readdir(pkg.extracted)
            .then(files => files.filter(x => x !== "__fv_"))
            .each(f => rimraf(Path.join(fullOutDir, f)))
            .then(() => readdir(pkg.extracted))
            .each(f => rename(Path.join(pkg.extracted, f), Path.join(fullOutDir, f)))
            .then(() => rimraf(pkg.extracted))
            .then(() => readdir(fvDir))
            .then(remainings => remainings.length === 0 && rimraf(fvDir))
            .then(readPkgJson);
        });
      }
    } else {
      return readPkgJson().catch(() =>
        mkdirp(fullOutDir)
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
          .then(readPkgJson)
      );
    }
  }
}

module.exports = PkgDistExtractor;
