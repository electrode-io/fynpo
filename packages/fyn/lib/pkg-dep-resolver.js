"use strict";

/* eslint-disable no-magic-numbers, max-params, max-statements */

const _ = require("lodash");
const Fs = require("./util/file-ops");
const Path = require("path");
const semverUtil = require("./util/semver");
const Semver = require("semver");
const Promise = require("bluebird");
const chalk = require("chalk");
const logger = require("./logger");
const DepItem = require("./dep-item");
const PromiseQueue = require("./util/promise-queue");
const PkgOptResolver = require("./pkg-opt-resolver");
const createDefer = require("./util/defer");
const simpleSemverCompare = semverUtil.simpleCompare;
const logFormat = require("./util/log-format");
const { LONG_WAIT_META } = require("./log-items");
const { checkPkgOsCpu } = require("./util/fyntil");

const {
  SEMVER,
  RSEMVERS,
  LOCK_RSEMVERS,
  SORTED_VERSIONS,
  LOCK_SORTED_VERSIONS,
  LOCAL_VERSION_MAPS,
  RESOLVE_ORDER,
  PACKAGE_RAW_INFO,
  DEP_ITEM
} = require("./symbols");

/*
 * Package dependencies resolver
 *
 * - 1. From top level package.json, add all dependencies to list
 * - 2. Take each package, retrieve their meta data
 * - 3. Match semver to the best version
 * - 4. Fetch package.json for the matched version
 * - 5. Add dependencies and optionalDependencies to list
 * - 6. Back to step 2 until all packages are processed in list
 *
 * Basically doing level order traversal on the dependency tree using an
 * async queue.
 */

class PkgDepResolver {
  constructor(pkg, options) {
    this._options = Object.assign({}, options);
    // The master object
    this._fyn = this._options.fyn;
    // Package source data manager
    this._pkgSrcMgr = this._fyn._pkgSrcMgr;
    // Dependencies data
    this._data = options.data;
    // Promise Queue to process all dependencies in list
    this._promiseQ = new PromiseQueue({
      concurrency: Math.max(this._fyn.concurrency * 2, 15),
      stopOnError: true,
      processItem: x => this.processItem(x)
    });
    this._defer = createDefer();
    this._promiseQ.on("done", x => {
      return this.done(x);
    });
    this._promiseQ.on("pause", x => this.onPause(x));
    this._promiseQ.on("fail", data => {
      return this._defer.reject(data.error);
    });
    this._optResolver = new PkgOptResolver({ fyn: this._fyn, depResolver: this });
    this._promiseQ.on("empty", () => this.checkOptResolver());
    this._lockOnly = this._fyn.lockOnly;
    //
    // We have to resolve each package in the order they were seen
    // through the dep tree because in case an earlier resolved version
    // satisfies a later semver.
    //
    // We also need to make sure each depth has to resolve completely before
    // dependencies in the next depth level can be resolved.
    //
    // In the _depthResolving object, each depth level # is used as a key to an
    // object with info about the status of resolving that level.
    //
    // - contains package name to array of DepItem seen in order.
    // - When ready to resolve a depth, all names are queued for processing.
    //
    this._depthResolving = { 0: {} };
    this.addPkgDepItems(
      this.makePkgDepItems(
        pkg,
        new DepItem({
          name: "~package.json",
          semver: "-",
          src: "",
          dsrc: "pkg",
          resolved: "~",
          shrinkwrap: options.shrinkwrap
        }),
        !this._fyn.production
      )
    );
    this.queueDepth(0);
  }

  start() {
    this._promiseQ.resume();
  }

  wait() {
    return this._defer.promise;
  }

  checkOptResolver() {
    if (!this._optResolver.isEmpty()) {
      this._optResolver.resolve();
      return true;
    }
    return false;
  }

  //
  // any package that only has a single version is promoted
  // promote priority by src: dep, dev, opt
  //
  // TODO: support options:
  // - Promote the latest version
  // - Promote the version with the most requests
  // - Promote the earliest version
  // - Allow explicit config to specify what version/semver to promote
  //
  promotePackages() {
    let version;

    const pkgsData = this._data.getPkgsData();
    const names = Object.keys(pkgsData);

    names.forEach(name => {
      const pkg = pkgsData[name];
      const versions = Object.keys(pkg);
      // there's only one version, auto protomote
      if (versions.length === 1) {
        version = versions[0];
      } else if (!(version = _.find(versions, v => pkg[v].top))) {
        // promote the first seen version
        version = pkg[RESOLVE_ORDER][0];
      }
      const pkgV = pkg[version];
      pkgV.promoted = true;
      const extracted = this._optResolver.isExtracted(name, version);
      if (extracted) {
        pkgV.extracted = extracted;
      }
    });
  }

  onPause() {
    // logger.info("onPause");
    // if optional resolver kicked off, then it will resume dep resolver
    // when it's done.
    if (!this.checkOptResolver()) {
      this._promiseQ.resume();
    }
  }

  done(data) {
    if (!this.checkOptResolver() && this._promiseQ.isPause) {
      this._promiseQ.resume();
    } else if (!this._optResolver.isPending()) {
      logger.removeItem(LONG_WAIT_META);
      const time = logFormat.time(data.totalTime);
      logger.info(`${chalk.green("done resolving dependencies")} ${time}`);
      this._data.sortPackagesByKeys();
      this.promotePackages();
      this._depthResolving = undefined;
      this._defer.resolve();
    }
  }

  resolvePkgPeerDep(json, pkgId, depInfo) {
    _.each(json.peerDependencies || json.peerDepenencies, (semver, name) => {
      const peerId = chalk.cyan(`${name}@${semver}`);
      const resolved = this.resolvePackage({ name, semver });
      if (!resolved) {
        logger.warn(
          chalk.yellow("Warning:"),
          `peer dependencies ${peerId} of ${pkgId} ${chalk.red("is missing")}`
        );
      } else {
        logger.debug(
          `peer dependencies ${peerId} of ${pkgId}`,
          `${chalk.green("resolved to")} ${resolved}`
        );
        _.set(depInfo, ["res", "per", name], { resolved });
      }
    });
  }

  resolvePeerDep(depInfo) {
    const json = depInfo.json;
    if (!json) return undefined;
    const pkgId = logFormat.pkgId(depInfo);
    return this.resolvePkgPeerDep(json, pkgId, depInfo);
  }

  queueDepth(depth) {
    if (depth > 1) {
      const parentDepth = this._depthResolving[depth - 1];
      // add all packages' dependencies according to their appearing order
      // that's in the parent's dependency lists, therefore guaranteeing
      // a consistent resolving order
      Object.keys(parentDepth).forEach(x => {
        const depthInfo = parentDepth[x];
        if (depthInfo.versions) {
          depthInfo.versions.forEach(version => this._data.addResolved({ name: x, version }));
        }
        if (depthInfo.depItems) {
          depthInfo.depItems.forEach(x2 => this.addPkgDepItems(x2));
          depthInfo.depItems = undefined;
        }
      });
    }
    const depthInfo = this._depthResolving[depth];
    if (!depthInfo) return;
    this._depthResolving.current = depth;
    Object.keys(depthInfo).forEach(x => this._promiseQ.addItem(x, true));
    this._promiseQ.addItem(PromiseQueue.pauseItem, true);
    this._promiseQ.addItem({ queueDepth: true, depth: depth + 1 }, true);
    // depthInfo.names = {};
  }

  prefetchMeta(item) {
    // fire-and-forget to retrieve meta
    // if it's not local, doesn't have meta yet, and doesn't have lock data
    if (!item.semverPath && !this._pkgSrcMgr.hasMeta(item) && !this._fyn.depLocker.hasLock(item)) {
      this._pkgSrcMgr.fetchMeta(item);
    }
  }

  addDepResolving(deps) {
    deps.forEach(depItem => {
      const name = depItem.name;
      const depthData = this._depthResolving[depItem.depth];
      if (!depthData) {
        this._depthResolving[depItem.depth] = {
          [name]: { items: [depItem] }
        };
      } else if (!depthData[name]) {
        depthData[name] = { items: [depItem] };
      } else {
        depthData[name].items.push(depItem);
      }
    });
  }

  addPkgDepItems(data) {
    if (data.dep) this.addDepResolving(data.dep);
    if (data.dev) this.addDepResolving(data.dev);
    let opt = false;
    if (data.opt) {
      this.addDepResolving(data.opt);
      opt = true;
    }
    if (data.devOpt) {
      this.addDepResolving(data.devOpt);
      opt = true;
    }
    if (opt) {
      this._promiseQ.addItem(PromiseQueue.pauseItem, true);
    }
  }

  makePkgDepItems(pkg, parent, dev, noPrefetch, deepResolve) {
    const bundled = pkg.bundleDependencies;

    const makeDepItems = (deps, dsrc) => {
      const items = [];
      const src = parent.src || dsrc;
      for (const name in deps) {
        if (!bundled || bundled.indexOf(name) < 0) {
          const opt = { name, semver: deps[name], src, dsrc, deepResolve };
          const newItem = new DepItem(opt, parent);

          if (noPrefetch !== true) this.prefetchMeta(newItem);
          items.push(newItem);
          // this._promiseQ.addItem(name, true);
        }
      }
      return items;
    };

    //
    // remove optional dependencies from dependencies
    //
    const filterOptional = (deps, optDep) => {
      if (_.isEmpty(optDep)) return deps;
      _.each(optDep, (v, n) => {
        if (deps[n]) {
          optDep[n] = deps[n]; // take semver from deps
          delete deps[n]; // and keep it as optional
        }
      });
      return deps;
    };

    const joinFynDep = sec => {
      if (!this._fyn.fynlocal) return pkg[sec];

      const deps = Object.assign({}, pkg[sec]);

      const fynDeps = _.get(pkg, ["fyn", sec], {});
      const rawInfo = pkg[PACKAGE_RAW_INFO] || {};

      for (const name in fynDeps) {
        if (!deps[name]) {
          logger.warn(`You ONLY defined ${name} in fyn.${sec}!`);
        }
        if (!rawInfo.dir) continue;
        const dispSec = chalk.cyan(`fyn.${sec}`);
        const ownerName = chalk.magenta(parent.name);
        const dispName = chalk.green(name);
        const dispSemver = chalk.blue(fynDeps[name]);
        try {
          Fs.statSync(Path.join(rawInfo.dir, fynDeps[name]));
          deps[name] = fynDeps[name];
          logger.info(`${dispSec} ${dispName} of ${ownerName} will use`, dispSemver);
        } catch (err) {
          logger.warn(
            `${dispSec} ${dispName} of ${ownerName} not found`,
            chalk.red(err.message),
            "pkg local dir",
            chalk.blue(rawInfo.dir),
            "dep name",
            dispSemver
          );
          if (err.code !== "ENOENT") {
            logger.error("checking local package failed", err.stack);
          }
        }
      }

      return !_.isEmpty(deps) && deps;
    };

    const dependencies = joinFynDep("dependencies");
    const devDep = dev && joinFynDep("devDependencies");
    const optDep = joinFynDep("optionalDependencies");
    const devOptDep = dev && joinFynDep("devOptDependencies");

    return {
      name: pkg.name,
      dep: dependencies && makeDepItems(filterOptional(dependencies, optDep), "dep"),
      dev: devDep && makeDepItems(devDep, "dev"),
      opt: optDep && makeDepItems(optDep, "opt"),
      devOpt: devOptDep && makeDepItems(devOptDep, "devopt")
    };
  }

  findVersionFromDistTag(meta, semver) {
    if (Semver.validRange(semver) === null) {
      const lockRsv = meta[LOCK_RSEMVERS];
      if (lockRsv && lockRsv[semver]) {
        return lockRsv[semver];
      }

      const dtags = meta["dist-tags"];
      if (dtags && dtags.hasOwnProperty(semver)) {
        return dtags[semver];
      }
    }
    return undefined;
  }

  _shouldDeepResolve(pkgDepInfo) {
    // even if an item has a resolved pkg, we need to make sure the pkg is resolved
    // by more than optionals, since optionals could potentially be removed later.
    return Boolean(this._fyn.deepResolve || !pkgDepInfo._hasNonOpt);
  }

  /* eslint-disable max-statements, complexity */

  async addPackageResolution(item, meta, resolved) {
    let firstKnown = true;
    item.resolve(resolved, meta);

    const pkgsData = this._data.getPkgsData(item.optFailed);
    let pkgV; // specific version of the known package
    let kpkg = pkgsData[item.name]; // known package

    if (kpkg) {
      kpkg[RESOLVE_ORDER].push(resolved);
      pkgV = kpkg[resolved];

      firstKnown = this.addKnownRSemver(kpkg, item, resolved);
      const dr = this._fyn.deepResolve || item.deepResolve;

      // If doing deep resolve and package is already seen, then check parents
      // to make sure it's not one of them because that would be a circular dependencies
      if (dr && pkgV && !item.optChecked && item.isCircular()) {
        // logger.log("circular dep detected", item.name, item.resolved);
        item.unref();
        item = undefined;
        return null;
      }
    }

    const metaJson = meta.versions[resolved];

    const platformCheck = () => {
      const sysCheck = checkPkgOsCpu(metaJson);
      if (sysCheck !== true) {
        return `package ${logFormat.pkgId(item)} platform check failed: ${sysCheck}`;
      }
      return true;
    };
    //
    // specified as optionalDependencies
    // add to opt resolver to resolve later
    //
    // Adding an optional package that failed:
    //
    // If a package from optional dependencies failed, then it won't be
    // installed, but we should remember it in lock file so we won't try
    // to download its tarball again to test.
    //
    // Optional checks may involve running a package's npm script.
    // - that should occur without blocking the dep resolution process
    // - but need to queue them up so when dep resolve queue is drained, need to
    //   wait for them to complete, and then resolve the next dep tree level
    //
    if (item.dsrc && item.dsrc.includes("opt") && !item.optChecked) {
      const sysCheck = platformCheck();

      if (sysCheck !== true) {
        logger.info(`optional dependencies ${sysCheck}`);
      } else {
        logger.verbose("adding package", item.name, item.semver, item.resolved, "to opt check");

        this._optResolver.add({ item, meta });
      }

      return null;
    }

    const sysCheck = platformCheck();
    if (sysCheck !== true) {
      logger.error(sysCheck);
      throw new Error(sysCheck);
    }

    if (!kpkg) {
      kpkg = pkgsData[item.name] = {
        [RSEMVERS]: {},
        [RESOLVE_ORDER]: [resolved]
      };

      if (meta[LOCK_RSEMVERS]) kpkg[LOCK_RSEMVERS] = meta[LOCK_RSEMVERS];

      firstKnown = this.addKnownRSemver(kpkg, item, resolved);
    }

    let firstSeenVersion = false;

    if (!pkgV) {
      firstSeenVersion = true;
      pkgV = kpkg[resolved] = {
        [item.src]: 0,
        requests: [],
        src: item.src,
        dsrc: item.dsrc,
        dist: metaJson.dist,
        name: item.name,
        version: resolved,
        [SEMVER]: item.semver,
        [DEP_ITEM]: item,
        res: {}
      };
      if (meta[LOCK_RSEMVERS]) pkgV.fromLock = true;
      const scripts = metaJson.scripts || {};
      if (metaJson.hasPI || scripts.preinstall || scripts.preInstall) {
        pkgV.hasPI = 1;
      }
      if (metaJson.hasI || scripts.install || scripts.postinstall || scripts.postInstall) {
        pkgV.hasI = 1;
      }
    }

    const localFromMeta = meta.local || metaJson.local;
    if (localFromMeta) {
      if (!item.localType) {
        item.localType = localFromMeta;
      }
      pkgV.local = item.localType;
      item.fullPath = pkgV.dir = pkgV.dist.fullPath;
      pkgV.str = meta.jsonStr;
      pkgV.json = metaJson;
    }

    if (!item.parent.depth) {
      pkgV.top = true;
    }

    if (item.dsrc && item.dsrc.includes("opt")) {
      pkgV.preInstalled = true;
      if (item.optFailed) pkgV.optFailed = item.optFailed;
    }

    // TODO: remove support for local sym linked packages
    if (
      !pkgV.extracted &&
      pkgV.local !== "sym" &&
      (this._fyn.alwaysFetchDist || (metaJson._hasShrinkwrap && !metaJson._shrinkwrap))
    ) {
      if (metaJson._hasShrinkwrap) pkgV._hasShrinkwrap = metaJson._hasShrinkwrap;
      await this._fyn._distFetcher.putPkgInNodeModules(pkgV, true);
      if (metaJson._hasShrinkwrap) await item.loadShrinkwrap(pkgV.extracted);
    }

    if (!item.optFailed) {
      if (metaJson.deprecated) pkgV.deprecated = metaJson.deprecated;
      let deepRes = false;
      if (firstSeenVersion || (deepRes = this._shouldDeepResolve(pkgV))) {
        const pkgDepth = this._depthResolving[item.depth][item.name];
        if (firstSeenVersion) {
          if (!pkgDepth.versions) pkgDepth.versions = [resolved];
          else pkgDepth.versions.push(resolved);
        }
        if (!pkgDepth.depItems) pkgDepth.depItems = [];
        if (deepRes) {
          logger.debug("Auto deep resolving", logFormat.pkgId(item));
        }
        pkgDepth.depItems.push(this.makePkgDepItems(meta.versions[resolved], item, false, deepRes));
      }
      item.addRequestToPkg(pkgV, firstSeenVersion);
      item.addResolutionToParent(this._data, firstKnown);
    }

    return null;
  }

  addKnownRSemver(kpkg, item, resolved) {
    const lockRsv = kpkg[LOCK_RSEMVERS];
    const rsv = kpkg[RSEMVERS];

    const missingVersion = (res, version) => {
      if (res) {
        return Array.isArray(res) ? res.indexOf(version) < 0 : res !== version;
      }
      return true;
    };

    const firstKnown = _.isEmpty(rsv);
    const semver = item.semver;

    if (missingVersion(rsv[semver], resolved)) {
      // are we updating locked info? => log info
      if (lockRsv && lockRsv[semver] && missingVersion(lockRsv[semver], resolved)) {
        logger.info(
          `locked version ${lockRsv[semver]} for ${logFormat.pkgId(item)}` +
            ` doesn't match resolved version ${resolved} - updating.`
        );
      }

      if (rsv[semver]) {
        if (Array.isArray(rsv[semver])) {
          rsv[semver].push(resolved);
        } else {
          rsv[semver] = [rsv[semver], resolved];
        }
      } else {
        rsv[semver] = resolved;
      }
    }

    return firstKnown;
  }

  resolvePackage(item, meta, noLocal) {
    const kpkg = this._data.getPkg(item); // known package

    const getKnownSemver = () => {
      const find = rsv => {
        let x = rsv && rsv[item.semver];
        if (!x) return x;
        if (Array.isArray(x)) x = x[0];
        if (noLocal && semverUtil.isLocal(x)) return false;
        return x;
      };
      const resolved =
        (kpkg && (find(kpkg[LOCK_RSEMVERS]) || find(kpkg[RSEMVERS]))) ||
        find(meta && meta[LOCK_RSEMVERS]);

      return resolved;
    };

    const satisfies = (v, sv) => {
      if (noLocal && semverUtil.isLocal(v)) return false;
      return semverUtil.satisfies(v, sv);
    };

    const searchKnown = () => {
      //
      // Search already known versions from top dep
      //
      if (!kpkg) return false;
      const rversions = kpkg[RESOLVE_ORDER];
      let resolved;
      if (rversions.length > 0) {
        resolved = _.find(rversions, v => satisfies(v, item.semver));
      }

      if (resolved) {
        logger.debug("found known version", resolved, "that satisfied", item.name, item.semver);
      }

      return resolved;
    };

    const searchMeta = () => {
      //
      // This sorting and semver searching is the most expensive part of the
      // resolve process, so caching them is very important for performance.
      //
      if (!meta[SORTED_VERSIONS]) {
        if (!meta.versions) {
          const msg = `Meta for package ${item.name} doesn't have versions`;
          logger.error(msg);
          throw new Error(msg);
        }

        meta[SORTED_VERSIONS] = Object.keys(meta.versions).sort(simpleSemverCompare);
      }

      const lockTime = this._fyn.lockTime;

      const find = (versions, times) => {
        if (!versions) return null;
        const countVer = Object.keys(versions).length;

        return _.find(versions, v => {
          if (!satisfies(v, item.semver)) {
            return false;
          }

          if (!lockTime || !times || !times[v] || countVer < 2) return true;

          const time = new Date(times[v]);
          if (time > this._fyn.lockTime) {
            // logger.debug("times", times);
            logger.verbose(
              item.name,
              v,
              "time",
              time.toString(),
              "is newer than lock",
              this._fyn.lockTime.toString()
            );
            return false;
          }

          return true;
        });
      };

      const resolved = find(meta[LOCK_SORTED_VERSIONS]) || find(meta[SORTED_VERSIONS], meta.time);
      // logger.log("found meta version", resolved, "that satisfied", item.name, item.semver);

      return resolved;
    };

    const getLocalVersion = () => {
      if (!meta) return false;
      if (meta.hasOwnProperty(LOCAL_VERSION_MAPS)) {
        logger.debug(
          `meta LOCAL_VERSION_MAPS for ${item.semver} - ${JSON.stringify(meta[LOCAL_VERSION_MAPS])}`
        );
        return meta[LOCAL_VERSION_MAPS][item.semver];
      }
      return false;
    };

    const getUrlVersion = () => {
      return (
        Boolean(meta && meta.urlVersions && item.urlType) && meta.urlVersions[item.semver].version
      );
    };

    const resolved =
      (!noLocal && getLocalVersion()) ||
      getUrlVersion() ||
      getKnownSemver() ||
      searchKnown() ||
      this.findVersionFromDistTag(meta, item.semver) ||
      (meta && searchMeta());

    // logger.debug("resolved to", resolved, "for", item.name, item.semver);

    // if resolving according to a meta, then make sure it contains the resolved version
    return meta ? meta.versions[resolved] && resolved : resolved;
  }

  _resolveWithMeta(item, meta, force, noLocal) {
    let resolved = item.nestedResolve(item.name, item.semver);

    if (resolved) {
      if (!meta.versions.hasOwnProperty(resolved)) {
        resolved = false;
      }
    } else {
      resolved = this.resolvePackage(item, meta, noLocal);
    }

    if (!resolved) {
      if (!force) return false;
      throw new Error(`No version of ${item.name} satisfied semver ${item.semver}`);
    }

    if (semverUtil.isLocal(resolved)) {
      if (noLocal) {
        // logger.debug("noLocal:", item.name, item.semver, "resolved to local", resolved);
        return false;
      }
      //
      // The item was ealier resolved to a local package, which also satifies
      // the semver currently being searched, so switch to use meta generated
      // for the local package
      //
      if (!meta.local) {
        const x = this._pkgSrcMgr.getLocalPackageMeta(item, resolved);
        if (x) meta = x;
      }
    }

    // this.addPackageResolution(item, meta, resolved);

    return { meta, resolved };
  }

  _resolveWithLockData(item) {
    //
    // Force resolve from lock data in regen mode if item was not a direct
    // optional dependency.
    //
    const isOpt = item.dsrc && item.dsrc.includes("opt");

    // if refresh optionals then can't use lock data for optionalDependencies
    if (isOpt && this._fyn.refreshOptionals) {
      return false;
    }

    const force = this._lockOnly && isOpt;

    // check if an already resolved local package satisfies item
    // before trying to resolve with lock data
    if (!this._fyn.preferLock) {
      const localMeta = this._pkgSrcMgr.getAllLocalMetaOfPackage(item.name);

      if (localMeta) {
        for (const v in localMeta) {
          const localResolve = this._resolveWithMeta(item, localMeta[v]);
          if (localResolve) {
            return localResolve;
          }
        }
      }
    }

    const locked = this._fyn.depLocker.convert(item);

    if (locked) {
      const resolved = this._resolveWithMeta(item, locked, force, !this._fyn.preferLock);
      // if (!item.semverPath ) {
      //   logger.warn(
      //     item.name,
      //     item.semver,
      //     "is locked to a locally linked version at",
      //     item.fullPath
      //   );
      // }
      // logger.debug(item.name, item.semver, "resolved from lock data", resolved);

      return resolved;
    }

    if (force) {
      throw new Error(`No version of ${item.name} from lock data satisfied semver ${item.semver}`);
    }

    // unable to resolve with lock data
    return false;
  }

  processItem(name) {
    if (name && name.promise) {
      const p = name.promise;
      name.promise = null;
      return p;
    }

    if (name && name.queueDepth) {
      return this.queueDepth(name.depth);
    }

    const depthData = this._depthResolving[this._depthResolving.current];
    // logger.info("resolving item", name, this._depthResolving.current, di);
    const items = depthData[name].items;
    if (items && items.length > 0) {
      return this.resolveItem(items.shift());
    }
    return undefined;
  }

  resolveItem(item) {
    const tryLocal = () => {
      return Promise.try(() => this._pkgSrcMgr.fetchLocalItem(item)).then(meta => {
        if (meta) {
          if (!this._fyn.needFlatModule) {
            this._fyn.needFlatModule = meta.local === "sym";
          }
          const updated = this._fyn.depLocker.update(item, meta);
          return this._resolveWithMeta(item, updated, true);
        }
        return false;
      });
    };

    const tryLock = () => {
      return Promise.try(() => this._resolveWithLockData(item));
    };

    const promise =
      !item.semverPath || this._fyn.preferLock
        ? tryLock().then(r => r || (item.semverPath && tryLocal()))
        : tryLocal().then(r => r || tryLock());

    return promise
      .then(r => {
        if (r) return r;

        if (this._lockOnly || item.localType) return undefined;
        // neither local nor lock was able to resolve for item
        // so try to fetch from registry for real meta to resolve
        // always fetch the item and let pkg src manager deal with caching
        return this._pkgSrcMgr.fetchMeta(item).then(meta => {
          if (!meta) {
            throw new Error(`Unable to retrieve meta for package ${item.name}`);
          }
          const updated = this._fyn.depLocker.update(item, meta);
          return this._resolveWithMeta(item, updated, true, true);
        });
      })
      .then(async r => {
        if (!r) return;

        const { meta, resolved } = r;
        await this.addPackageResolution(item, meta, resolved);
      })
      .then(() => {
        const depthData = this._depthResolving[item.depth];
        const items = depthData[item.name].items;

        depthData[item.name].items = [];

        return Promise.each(items, x => this.resolveItem(x));
      });
  }
}

module.exports = PkgDepResolver;
