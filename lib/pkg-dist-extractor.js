"use strict";

/* eslint-disable no-magic-numbers */

const Tar = require("tar");
const Path = require("path");
const Fs = require("fs");
const Promise = require("bluebird");
const _ = require("lodash");
const chalk = require("chalk");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const readdir = Promise.promisify(Fs.readdir);
const rename = Promise.promisify(Fs.rename);
const mkdirp = Promise.promisify(require("mkdirp"));
const rimraf = Promise.promisify(require("rimraf"));
const rmdir = Promise.promisify(Fs.rmdir);
const { LOAD_PACKAGE } = require("./log-items");

class PkgDistExtractor {
  constructor(options) {
    this._promiseQ = new PromiseQueue({
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

  wait() {
    return this._promiseQ.wait();
  }

  done(data) {
    logger.debug("done dist extracting", data.totalTime / 1000);
  }

  processItem(data) {
    const pkg = data.pkg;

    const fullOutDir = this._fyn.getInstalledPkgDir(pkg.name, pkg.version, pkg);

    if (pkg.extracted) {
      // do we have a copy of it in __fv_ already?
      logger.debug(
        "> package",
        pkg.name,
        pkg.version,
        "has already been extracted to",
        pkg.extracted
      );
      if (!pkg.promoted) {
        return this._fyn.readPkgJson(pkg);
      } else {
        // just move it to top dir
        // first make sure top dir is clear of any other files
        // then move it
        // delete __fv_/<version> dir

        // Since it's been promoted, we know fullOutDir doesn't have __fv_
        return this._fyn.clearPkgOutDir(fullOutDir).then(() => {
          return readdir(pkg.extracted)
            .each(f => rename(Path.join(pkg.extracted, f), Path.join(fullOutDir, f)))
            .then(() => rmdir(pkg.extracted).catch(_.noop))
            .then(() => rmdir(Path.join(fullOutDir, "__fv_")).catch(_.noop))
            .then(() => this._fyn.readPkgJson(pkg));
        });
      }
    } else {
      return this._fyn.readPkgJson(pkg).catch(() =>
        this._fyn
          .createPkgOutDir(fullOutDir)
          .then(() => {
            logger.debug("extracting", data.fullTgzFile);
            return Tar.x({
              file: data.fullTgzFile,
              strip: 1,
              strict: true,
              C: fullOutDir
            });
          })
          .then(() => {
            let msg;
            const x = fullOutDir.indexOf(pkg.name);
            if (x > 0) {
              msg =
                chalk.blue("node_modules/") +
                chalk.magenta(pkg.name) +
                fullOutDir.substr(x + pkg.name.length);
            } else {
              msg = chalk.blue(fullOutDir);
            }
            logger.updateItem(LOAD_PACKAGE, `package extracted ${msg}`);
          })
          .then(() => this._fyn.readPkgJson(pkg))
      );
    }
  }
}

module.exports = PkgDistExtractor;
