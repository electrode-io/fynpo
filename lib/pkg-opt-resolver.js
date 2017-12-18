"use strict";

const assert = require("assert");
const Fs = require("fs");
const Path = require("path");
const Tar = require("tar");
const xsh = require("xsh");
const _ = require("lodash");
const Promise = require("bluebird");
const readFile = Promise.promisify(Fs.readFile);
const mkdirp = Promise.promisify(require("mkdirp"));
const PromiseQueue = require("./util/promise-queue");
const logger = require("./logger");
const Inflight = require("./util/inflight");
const LifecycleScripts = require("./lifecycle-scripts");
const chalk = require("chalk");
const longPending = require("./long-pending");
const CliLogger = require("./cli-logger");
const logFormat = require("./util/log-format");
const { OPTIONAL_RESOLVER } = require("./log-items");

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
    this._resolving = false;
    this._extractedPkgs = {};
    this._failedChecks = [];
    this._failedPkgs = [];
    this._depResolver = options.depResolver;
    this._inflights = new Inflight();
    this._fyn = options.fyn;
    this._promiseQ = new PromiseQueue({
      concurrency: 2,
      stopOnError: false,
      watchTime: 2000,
      processItem: x => this.optCheck(x)
    });
    this._promiseQ.on("watch", items => {
      items.watched = items.watched.filter(x => !x.item.runningScript);
      items.still = items.still.filter(x => !x.item.runningScript);
      items.total = items.watched.length + items.still.length;
      longPending.onWatch(items, {
        makeId: item => {
          item = item.item;
          return chalk.magenta(`${item.name}@${item.resolved}`);
        }
      });
    });
    this._promiseQ.on("done", () => logger.remove(OPTIONAL_RESOLVER));
    this._promiseQ.on("fail", x => logger.error("opt-check fail", x));
    this._promiseQ.on("failItem", x => logger.error("opt-check failItem", x.error));
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
  /* eslint-disable max-statements */
  optCheck(data) {
    const name = data.item.name;
    const version = data.item.resolved;
    const pkgId = `${name}@${version}`;
    const displayId = logFormat.pkgId(data.item);

    const processCheckResult = promise => {
      return promise.then(res => {
        if (res.passed) {
          // exec exit status 0, add to defer resolve queue
          this._passedPkgs.push(data);
        } else {
          // exec failed, add to queue for logging at end
          this._failedPkgs.push(data);
          this._failedChecks.push({ err: res.err, data });
        }
      });
    };

    const addChecked = res => {
      if (!this._checkedPkgs[pkgId]) this._checkedPkgs[pkgId] = res;
    };

    const logFail = msg => {
      logger.warn(chalk.yellow(`optional dep check failed`), displayId, chalk.yellow(`- ${msg}`));
    };

    const logPass = (msg, level) => {
      level = level || "verbose";
      logger[level](chalk.green(`optional dep check passed`), displayId, chalk.green(`- ${msg}`));
    };

    // already check in progress
    const inflight = this._inflights.get(pkgId);
    if (inflight) {
      return processCheckResult(inflight);
    }

    // already check completed, just use existing result
    if (this._checkedPkgs[pkgId]) {
      return processCheckResult(Promise.resolve(this._checkedPkgs[pkgId]));
    }

    if (_.get(data, ["meta", "versions", version, "optFailed"])) {
      logFail("by flag optFailed in lockfile");
      const rx = {
        passed: false,
        err: new Error("optional dep fail by flag optFailed in lockfile")
      };
      addChecked(rx);
      return processCheckResult(Promise.resolve(rx));
    }

    const checkPkg = path => {
      return readFile(Path.join(path, "package.json"))
        .then(JSON.parse)
        .then(pkg => pkg.version === version && { path, pkg });
    };

    const pkgFromMeta = data.meta.versions[version];
    let installedPath = this._fyn.getInstalledPkgDir(name, version, { promoted: true });
    // is it under node_modules/<name> and has the right version?
    const promise = Promise.try(() => {
      const scripts = pkgFromMeta.scripts;
      if (pkgFromMeta.hasOwnProperty("$")) {
        // it's locked meta and hasPI is not 1
        if (pkgFromMeta.hasPI !== 1) {
          return pkgFromMeta;
        }
      } else if (!scripts || !scripts.preinstall) {
        // full meta and doesn't have scripts or preinstall in scripts
        return pkgFromMeta;
      }
      // package actuall has preinstall script, then need to fetch package tarball
      // to try to execute the preinstall script
      return checkPkg(installedPath);
    })
      .catch(() => {
        // is it under node_modules/<name>/__fv_/<version>?
        installedPath = this._fyn.getInstalledPkgDir(name, version, { promoted: false });
        return checkPkg(installedPath);
      })
      .catch(() => {
        if (this._fyn.regenOnly) {
          //
          // regen only, don't bother fetching anything
          //
          return "regenOnlyFail";
        }

        const spinner = CliLogger.spinners[1];
        logger.addItem({ name: OPTIONAL_RESOLVER, color: "green", watchTime: 3000, spinner });
        logger.updateItem(OPTIONAL_RESOLVER, `loading package ${displayId}`);
        const dist = data.meta.versions[version].dist;
        // none found, fetch tarball
        return this._fyn.pkgSrcMgr
          .fetchTarball({ name, version, dist })
          .tap(() => mkdirp(installedPath))
          .then(res => {
            logger.updateItem(OPTIONAL_RESOLVER, `extracting package ${displayId}`);
            // extract tarball to node_modules/<name>/__fv_/<version>
            const tarXOpt = { file: res.fullTgzFile, strip: 1, strict: true, C: installedPath };
            return Promise.try(() => Tar.x(tarXOpt))
              .then(() => checkPkg(installedPath))
              .catch(err => {
                logger.error(
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
                logger.updateItem(OPTIONAL_RESOLVER, `extracted package ${displayId}`);
                this._extractedPkgs[pkgId] = installedPath;
              });
          });
      })
      .then(res => {
        if (res === "regenOnlyFail") {
          logFail("regen only but no package data");
          return { passed: false };
        }
        // run npm script `preinstall`
        const checked = _.get(res, "pkg._fyn.preinstall");
        if (checked) {
          logPass("preinstall script already passed");
          return { passed: true };
        } else if (_.get(res, "pkg.scripts.preinstall")) {
          data.runningScript = true;
          logger.updateItem(OPTIONAL_RESOLVER, `running preinstall for ${displayId}`);
          const ls = new LifecycleScripts({
            appDir: this._fyn.cwd,
            dir: installedPath,
            json: res.pkg
          });
          return ls
            .execute(["preinstall"], true)
            .then(() => {
              logPass("preinstall script exit with code 0", "info");
              return { passed: true };
            })
            .catch(err => {
              logFail("preinstall script failed");
              return { passed: false, err };
            });
        } else {
          // no preinstall script, always pass
          logPass("no preinstall script");
          return { passed: true };
        }
      })
      .tap(res => {
        assert(
          this._checkedPkgs[pkgId] === undefined,
          `opt-resolver already checked package ${pkgId}`
        );
        addChecked(res);
      })
      .finally(() => {
        this._inflights.remove(pkgId);
      });

    this._inflights.add(pkgId, promise);

    return processCheckResult(promise);
  }

  resolve() {
    this._optPkgCount = 0;
    this._resolving = true;
    this.start();
    return this._promiseQ.wait().then(() => {
      this._passedPkgs.forEach(x => {
        x.item.optChecked = true;
        this._depResolver.addPackageResolution(x.item, x.meta, x.item.resolved);
      });
      this._failedPkgs.forEach(x => {
        x.item.optChecked = true;
        x.item.optFailed = true;
        this._depResolver.addPackageResolution(x.item, x.meta, x.item.resolved);
      });
      this._passedPkgs = [];
      this._failedPkgs = [];
      this._resolving = false;
      this._depResolver.start();
    });
  }

  isPending() {
    return this._resolving === true;
  }

  isEmpty() {
    return this._optPkgCount === 0;
  }
}

module.exports = PkgOptResolver;
