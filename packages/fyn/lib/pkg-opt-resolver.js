"use strict";

/* eslint-disable max-nested-callbacks */

const assert = require("assert");
const xsh = require("xsh");
const _ = require("lodash");
const Promise = require("bluebird");
const PromiseQueue = require("./util/promise-queue");
const logger = require("./logger");
const Inflight = require("./util/inflight");
const LifecycleScripts = require("./lifecycle-scripts");
const chalk = require("chalk");
const hardLinkDir = require("./util/hard-link-dir");
const longPending = require("./long-pending");
const logFormat = require("./util/log-format");
const PkgDepLinker = require("./pkg-dep-linker");
const semverUtil = require("./util/semver");
const { readPkgJson } = require("./util/fyntil");
const { OPTIONAL_RESOLVER } = require("./log-items");

xsh.Promise = Promise;

//
// resolve optional dependencies
//
// If a package is in optional dep, then it should be:
//
// - the package itself resolved to a version with its meta.
// - queue up for deferred processing until regular dep are all resolved
// - optional packages are fetched and extracted to FV_DIR
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
    // to FV_DIR so we can avoid extrating it later
    //
    this._resolving = false;
    this._extractedPkgs = {};
    this._failedChecks = [];
    this._failedPkgs = [];
    this._depResolver = options.depResolver;
    this._inflights = new Inflight();
    this._fyn = options.fyn;
    this._depLinker = new PkgDepLinker({ fyn: this._fyn });
    this.setupQ();
  }

  setupQ() {
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
    this._promiseQ.on("done", () => logger.removeItem(OPTIONAL_RESOLVER));
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
  // - check if installed under FV_DIR
  // - if none, then fetch tarball and extract to FV_DIR
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
      if (!this._checkedPkgs[pkgId]) {
        this._checkedPkgs[pkgId] = res;
      }
    };

    const logFail = msg => {
      logger.warn(chalk.yellow(`optional dep check failed`), displayId, chalk.yellow(`- ${msg}`));
      logger.info(
        chalk.green(`  you may ignore this since it is optional but some features may be missing`)
      );
    };

    const logPass = (msg, level) => {
      level = level || "verbose";
      logger[level](chalk.green(`optional dep check passed`), displayId, chalk.green(`- ${msg}`));
    };

    // already check completed, just use existing result
    const checkedPkgRes = this._checkedPkgs[pkgId];
    if (checkedPkgRes) {
      return processCheckResult(Promise.resolve(checkedPkgRes));
    }

    // already check in progress
    const inflight = this._inflights.get(pkgId);
    if (inflight) {
      logger.debug("opt check reusing existing inflight for", pkgId);
      return processCheckResult(inflight);
    }

    if (!this._fyn.refreshOptionals && _.get(data, ["meta", "versions", version, "optFailed"])) {
      logFail("by flag optFailed in lockfile");
      const rx = {
        passed: false,
        err: new Error("optional dep fail by flag optFailed in lockfile")
      };
      addChecked(rx);
      return processCheckResult(Promise.resolve(rx));
    }

    const checkPkg = path => {
      return readPkgJson(path, true).then(pkg => {
        return semverUtil.equal(pkg.version, version) && { path, pkg };
      });
    };

    const fvInstalledPath = this._fyn.getInstalledPkgDir(name, version);

    const linkLocalPackage = async () => {
      const meta = data.meta;
      const local = meta.local || _.get(meta, ["versions", version, "local"]);
      logger.debug("opt resolver", name, version, "local", local);
      if (!local) return false;

      const dist = meta.versions[version].dist;
      logger.debug("opt resolver linking local package", name, version, dist);
      if (local === "sym") {
        // await this._depLinker.symlinkLocalPackage(fvInstalledPath, dist.fullPath);
        throw new Error("only hard linking local mode supported now. symlinking local deprecated");
      } else {
        await hardLinkDir.link(dist.fullPath, fvInstalledPath, {
          sourceMaps: this._fyn._options.sourceMaps
        });
      }
      return checkPkg(fvInstalledPath);
    };

    // is it under node_modules/<name> and has the right version?
    const promise = Promise.try(() => {
      if (data.err) {
        return "metaFail";
      }

      const pkgFromMeta = data.meta.versions[version];

      const scripts = pkgFromMeta.scripts;

      if (pkgFromMeta.fromLocked) {
        // it's locked meta and hasPI is not 1
        if (!this._fyn.refreshOptionals && pkgFromMeta.hasPI !== 1) {
          return pkgFromMeta;
        }
      } else if (!scripts || !scripts.preinstall) {
        // full meta and doesn't have scripts or preinstall in scripts
        return pkgFromMeta;
      }

      // package actually has preinstall script, first check if it's already
      // installed at top level in node_modules
      const pkg = Object.assign({}, pkgFromMeta, { name, version });

      return this._fyn._distFetcher.findPkgInNodeModules(pkg).then(find => {
        if (find.pkgJson) {
          return { pkg: find.pkgJson, path: find.existDir };
        }

        if (this._fyn.lockOnly) {
          // regen only, don't bother fetching anything
          return "lockOnlyFail";
        }

        // no existing install found, try to link local or fetch tarball into
        // ${FV_DIR}/<version>/<name>.
        return linkLocalPackage().then(linked => {
          if (linked) return linked;
          return this._fyn._distFetcher
            .putPkgInNodeModules(pkg, false, true)
            .then(() => checkPkg(fvInstalledPath))
            .catch(() => {
              return "fetchFail";
            });
        });
      });
    })
      // .catch(async () => {
      //   return (await linkLocalPackage()) || fetchPkgTarball(fvInstalledPath);
      // })
      .then(res => {
        if (res === "lockOnlyFail") {
          logFail("lock only but no package tarball");
          return { passed: false };
        }
        if (res === "fetchFail") {
          logFail("fetch tarball failed, your install likely will be bad.");
          return { passed: false };
        }
        if (res === "metaFail") {
          logFail("fetch meta failed");
          return { passed: false };
        }
        // run npm script `preinstall`
        if (!this._fyn.refreshOptionals && _.get(res, "pkg._fyn.preinstall")) {
          // package already installed and its package.json has _fyn.preinstall set
          // so do not run preinstall script again
          logPass(
            `_fyn.preinstall from package.json is '${res.pkg._fyn.preinstall}' => script already passed`
          );
          return { passed: true };
        } else if (_.get(res, "pkg.scripts.preinstall")) {
          data.runningScript = true;
          logger.updateItem(OPTIONAL_RESOLVER, `running preinstall for ${displayId}`);
          const ls = new LifecycleScripts({
            appDir: this._fyn.cwd,
            _fyn: this._fyn,
            dir: res.path,
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
          logPass(`package ${name} has no preinstall script`);
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
    return this._promiseQ.wait().then(async () => {
      for (const x of this._passedPkgs) {
        x.item.optChecked = true;
        await this._depResolver.addPackageResolution(x.item, x.meta, x.item.resolved);
      }
      for (const x of this._failedPkgs) {
        x.item.optChecked = true;
        x.item.optFailed = _.get(x, ["meta", "versions", x.item.resolved, "optFailed"], 1);
        await this._depResolver.addPackageResolution(x.item, x.meta, x.item.resolved);
      }
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
