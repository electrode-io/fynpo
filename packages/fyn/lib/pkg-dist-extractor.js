"use strict";

/* eslint-disable no-magic-numbers */

const Tar = require("tar");
const Path = require("path");
const Fs = require("fs");
const mkdirp = require("mkdirp");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const Promise = require("bluebird");

class PkgDistExtractor {
  constructor(options) {
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this._promiseQ = new PromiseQueue({
      stopOnError: true,
      processItem: x => this.processItem(x)
    });
    this._promiseQ.on("done", data => this.done(data));
    this._promiseQ.on("fail", data => {
      this._reject(data.error);
    });
    this._fyn = options.fyn;
  }

  addPkgDist(data) {
    this._promiseQ.addItem(data);
  }

  wait() {
    return this._promise;
  }

  done(data) {
    logger.log("done dist extracting", data.totalTime / 1000);
    this._resolve();
  }

  processItem(data) {
    const pkg = data.pkg;
    const fullOutDir = this._fyn.getInstalledPkgDir(pkg.name, pkg.version, pkg);
    mkdirp.sync(fullOutDir);
    return Tar.x({
      file: data.fullTgzFile,
      strip: 1,
      C: fullOutDir
    }).then(() => {
      logger.log(data.fullTgzFile, "extracted to", fullOutDir);
      const pkgJsonFname = Path.join(fullOutDir, "package.json");
      const pkgJson = JSON.parse(Fs.readFileSync(pkgJsonFname).toString());
      pkgJson.__fyn__ = pkg;
      if (pkg.promoted) {
        pkgJson._flatVersion = pkg.version;
      }
      Fs.writeFileSync(pkgJsonFname, JSON.stringify(pkgJson, null, 2));
    });
  }
}

module.exports = PkgDistExtractor;
