"use strict";

/* eslint-disable no-magic-numbers */

const Tar = require("tar");
const Path = require("path");
const Fs = require("fs");
const mkdirp = require("mkdirp");
const Promise = require("bluebird");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const writeFile = Promise.promisify(Fs.writeFile);

class PkgDistExtractor {
  constructor(options) {
    this._promiseQ = new PromiseQueue({
      stopOnError: true,
      processItem: (x, id) => this.processItem(x, id)
    });
    this._fyn = options.fyn;
    this._promiseQ.on("done", x => this.done(x));
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
    mkdirp.sync(fullOutDir);
    return Promise.try(() =>
      Tar.x({
        file: data.fullTgzFile,
        strip: 1,
        strict: true,
        C: fullOutDir
      })
    ).then(() => {
      logger.log(data.fullTgzFile, "extracted to", fullOutDir);
      const pkgJsonFname = Path.join(fullOutDir, "package.json");
      const pkgJson = JSON.parse(Fs.readFileSync(pkgJsonFname).toString());
      pkgJson.__fyn__ = pkg;
      if (pkg.promoted) {
        pkgJson._flatVersion = pkg.version;
      }
      return writeFile(pkgJsonFname, JSON.stringify(pkgJson, null, 2));
    });
  }
}

module.exports = PkgDistExtractor;
