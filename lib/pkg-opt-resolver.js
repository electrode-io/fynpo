"use strict";

const Fs = require("fs");
const Path = require("path");
const Tar = require("tar");
const xsh = require("xsh");
const Promise = require("bluebird");
const readFile = Promise.promisify(Fs.readFile);
const mkdirp = Promise.promisify(require("mkdirp"));
const PromiseQueue = require("./util/promise-queue");
const _ = require("lodash");
const logger = require("./logger");
const assert = require("assert");

xsh.Promise = Promise;

//
// resolve optional dependencies
//
// If a package is in optional dep, then it should be:
//
// - the package itself resolved to a version with its meta.
// - queue up for deferred processing until regular dep are all resolved
// - optional packages are fetched and extracted to __fv_
// - execute its preinstall script
// - package that failed is ignore
// - package that passed is added back to the regular resolving pipeline
// - all results saved for logging at the end
// - expect final clean-up to remove any ignored packages
//

class PkgOptResolver {
  constructor(options) {
    this._optPkgCount = 0;
    this._passedPkgs = [];
    this._checkedPkgs = {};
    //
    // for remembering that we've extrated a package by name@version ID
    // to __fv_ dir so we can avoid extrating it later
    //
    this._extractedPkgs = {};
    this._failedPkgs = [];
    this._depResolver = options.depResolver;
    this._inflights = {};
    this._fyn = options.fyn;
    this._promiseQ = new PromiseQueue({
      concurrency: 2,
      stopOnError: false,
      processItem: x => this.optCheck(x)
    });
    this._promiseQ.on("fail", x => logger.log("opt-check fail", x));
    this._promiseQ.on("failItem", x => logger.log("opt-check failItem", x.error));
  }

  //
  // optDep should contain:
  // - the item for the optional dep
  // - the meta info for the whole package
  //
  add(optDep) {
    this._optPkgCount++;
    this._promiseQ.addItem(optDep, true);
  }

  start() {
    this._promiseQ._process();
  }

  isExtracted(name, version) {
    return this._extractedPkgs[`${name}@${version}`];
  }

  //
  // - check if installed under node_modules
  // - check if installed under __fv_
  // - if none, then fetch tarball and extract to __fv_
  // - run preinstall npm script
  // - check if exit 0 or not
  // - 0: add item back to resolve
  // - not: add item to queue for logging at end
  //
  optCheck(data) {
    const name = data.item.name;
    const version = data.item.resolved;
    const pkgId = `${name}@${version}`;

    const processCheckResult = promise => {
      return promise.then(res => {
        if (res.passed) {
          // exec exit status 0, add to defer resolve queue
          this._passedPkgs.push(data);
        } else {
          // exec failed, add to queue for logging at end
          this._failedPkgs.push({ err: res.err, data });
        }
      });
    };

    // already check in progress
    if (this._inflights[pkgId]) {
      return processCheckResult(this._inflights[pkgId]);
    }

    // already check completed, just use existing result
    if (this._checkedPkgs[pkgId]) {
      return processCheckResult(Promise.resolve(this._checkedPkgs[pkgId]));
    }

    const checkPkg = path => {
      return readFile(Path.join(path, "package.json"))
        .then(JSON.parse)
        .then(pkg => pkg.version === version && { path, pkg });
    };

    let installedPath = this._fyn.getInstalledPkgDir(name, version, { promoted: true });
    // is it under node_modules/<name> and has the right version?
    this._inflights[pkgId] = checkPkg(installedPath)
      .catch(() => {
        // is it under node_modules/<name>/__fv_/<version>?
        installedPath = this._fyn.getInstalledPkgDir(name, version, { promoted: false });
        return checkPkg(installedPath);
      })
      .catch(() => {
        const dist = data.meta.versions[version].dist;
        // none found, fetch tarball
        return this._fyn.pkgSrcMgr
          .fetchTarball({ name, version, dist })
          .tap(() => mkdirp(installedPath))
          .then(res => {
            // extract tarball to node_modules/<name>/__fv_/<version>
            const tarXOpt = { file: res.fullTgzFile, strip: 1, strict: true, C: installedPath };
            return Promise.try(() => Tar.x(tarXOpt))
              .then(() => checkPkg(installedPath))
              .catch(err => {
                logger.log(
                  "opt-resolver: reading package.json from package extracted from",
                  res.fullTgzFile,
                  "failed."
                );
                throw err;
              })
              .tap(x => {
                assert(
                  x,
                  `opt-resolver: version of package in ${installedPath} extracted from ${
                    res.fullTgzFile
                  } didn't match ${version}!`
                );
                this._extractedPkgs[pkgId] = installedPath;
              });
          });
      })
      .then(res => {
        // run npm script `preinstall`
        const x = _.get(res, "pkg.scripts.preinstall");
        if (x) {
          logger.log("Running preinstall for optional dep", pkgId);
          return xsh
            .exec(x)
            .promise.thenReturn({ passed: true })
            .catch(err => ({ passed: false, err }));
        } else {
          // no preinstall script, always pass
          logger.log("no preinstall script - default pass for optional dep", pkgId);
          return { passed: true };
        }
      })
      .tap(res => {
        assert(
          this._checkedPkgs[pkgId] === undefined,
          `opt-resolver already checked package ${pkgId}`
        );
        this._checkedPkgs[pkgId] = res;
      })
      .finally(() => {
        delete this._inflights[pkgId];
      });

    return processCheckResult(this._inflights[pkgId]);
  }

  resolve() {
    this.start();
    return this._promiseQ.wait().then(() => {
      this._passedPkgs.forEach(x => {
        x.item.optChecked = true;
        this._depResolver.addPackageResolution(x.item, x.meta, x.item.resolved);
      });
      this._optPkgCount = 0;
      this._passedPkgs = [];
      this._depResolver.start();
    });
  }

  isEmpty() {
    return this._optPkgCount === 0;
  }
}

module.exports = PkgOptResolver;
