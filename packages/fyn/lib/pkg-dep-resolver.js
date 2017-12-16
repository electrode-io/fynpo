"use strict";

/* eslint-disable no-magic-numbers */

const assert = require("assert");
const _ = require("lodash");
const Semver = require("semver");
const Promise = require("bluebird");
const chalk = require("chalk");
const logger = require("./logger");
const DepItem = require("./dep-item");
// const DepData = require("./dep-data");
const PromiseQueue = require("./util/promise-queue");
const PkgOptResolver = require("./pkg-opt-resolver");
const defer = require("./util/defer");
const simpleSemverCompare = require("./util/simple-semver-compare");
const {
  RSEMVERS,
  LOCK_RSEMVERS,
  RVERSIONS,
  SORTED_VERSIONS,
  LOCK_SORTED_VERSIONS
} = require("./symbols");

const mapTopDep = (dep, src) =>
  Object.keys(dep || {}).map(name => new DepItem({ name, semver: dep[name], src, dsrc: src }));

/*
 * Package dependencies resolver
 *
 * - 1. From top level package.json, add all dependencies to list
 * - 2. Take each package, retrieve their meta data
 * - 3. Match semver to the best version
 * - 4. Fetch package.json for the matched version
 * - 5. Add dependencies and optionalDependencies to list
 * - 6. Back to step 2 until all packages are processed in list
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
      concurrency: 50,
      stopOnError: true,
      processItem: x => this.processItem(x),
      itemQ: mapTopDep(pkg.dependencies, "dep")
        .concat(mapTopDep(pkg.devDependencies, "dev"))
        .concat(mapTopDep(pkg.optionalDependencies, "opt"))
        .concat(PromiseQueue.pauseItem)
      // .concat(mapTopDep(pkg.peerDependencies, "per"))
    });
    this._defer = defer();
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("pause", x => this.onPause(x));
    this._promiseQ.on("fail", data => this._defer.reject(data.error));
    this._optResolver = new PkgOptResolver({ fyn: this._fyn, depResolver: this });
    this._promiseQ.on("empty", () => this.checkOptResolver());
    this._regenOnly = this._fyn.regenOnly;
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
      // sort versions from newest to oldest
      const versions = Object.keys(pkg);
      // there's only one version, auto protomote
      if (versions.length === 1) {
        version = versions[0];
      } else if (!(version = _.find(versions, v => pkg[v].top))) {
        const src = versions.sort(simpleSemverCompare).map(v => ({ v, s: pkg[v].src }));
        // find the first source that's not empty
        const bySrc = _.first(
          ["dep", "dev", "opt"]
            .map(s => src.filter(x => x.s.indexOf(s) >= 0))
            .filter(x => x.length > 0)
        );
        // promote latest version
        version = bySrc[0].v;
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
    if (!this.checkOptResolver()) {
      this._promiseQ.resume();
    }
  }

  done(data) {
    if (!this.checkOptResolver() && this._promiseQ.isPause) {
      this._promiseQ.resume();
    } else if (!this._optResolver.isPending()) {
      logger.info(
        `${chalk.green("done resolving dependencies")}`,
        chalk.magenta(`${data.totalTime / 1000}`) + "secs"
      );
      this._data.sortPackagesByKeys();
      this.promotePackages();
      this._defer.resolve();
    }
  }

  resolvePeerDep(depInfo) {
    const json = depInfo.json;
    if (!json) return;
    const pkgId = chalk.magenta(`${depInfo.name}@${depInfo.version}`);
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
        _.set(depInfo, ["res", "dep", name], { resolved });
      }
    });
  }

  addDepOfDep(mPkg, parent) {
    const bundled = mPkg.bundleDependencies;
    const add = (dep, src) => {
      let count = 0;
      for (const name in dep) {
        if (!bundled || bundled.indexOf(name) < 0) {
          const opt = { name, semver: dep[name], src: parent.src, dsrc: src };
          this._promiseQ.addItem(new DepItem(opt, parent), true);
          count++;
        }
      }
      return count;
    };

    //
    // remove optional dependencies from dependencies
    //
    if (mPkg.dependencies) {
      _.each(mPkg.optionalDependencies, (v, n) => {
        delete mPkg.dependencies[n];
      });
    }

    add(mPkg.dependencies, "dep");
    if (add(mPkg.optionalDependencies, "opt") > 0) {
      this._promiseQ.addItem(PromiseQueue.pauseItem);
    }
    this._promiseQ._process();
    // add(mPkg.peerDependencies, "per");
    // logger.log("addDepOfDep Q size", this._promiseQ._itemQ.length);
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

  //
  // Adding an optional package that failed:
  //
  // If a package from optional dependencies failed, then it won't be
  // installed, but we should remember it in lock file so we won't try
  // to download its tarball again to test.
  //

  /* eslint-disable max-statements */
  addPackageResolution(item, meta, resolved) {
    item.resolve(resolved);

    const pkgsData = this._data.getPkgsData(item.optFailed);
    let pkgV; // specific version of the known package
    let kpkg = pkgsData[item.name]; // known package

    if (kpkg) {
      pkgV = kpkg[resolved];

      // if package is already seen, then check parents to make sure
      // it's not one of them because that would be a circular dependencies
      if (pkgV && !item.optChecked && item.isCircular()) {
        // logger.log("circular dep detected", item.name, item.resolved);
        item.unref();
        item = undefined;
        return;
      }
    }

    // specified as optionalDependencies
    // add to opt resolver to resolve later
    if (item.dsrc === "opt" && !item.optChecked) {
      this._optResolver.add({ item, meta });
      return;
    }

    if (!kpkg) {
      kpkg = pkgsData[item.name] = {
        [RSEMVERS]: {},
        [RVERSIONS]: []
      };

      if (meta[LOCK_RSEMVERS]) kpkg[LOCK_RSEMVERS] = meta[LOCK_RSEMVERS];

      this.addKnownRSemver(kpkg, item, resolved);
    }

    const metaJson = meta.versions[resolved];

    let firstSeen = false;

    if (!pkgV) {
      firstSeen = true;
      pkgV = kpkg[resolved] = {
        [item.src]: 0,
        requests: [],
        src: item.src,
        dsrc: item.dsrc,
        dist: metaJson.dist,
        name: item.name,
        version: resolved,
        res: {}
      };
      if (meta[LOCK_RSEMVERS]) pkgV.fromLock = true;
    }

    if (meta.local) {
      pkgV.local = true;
      pkgV.dir = pkgV.dist.fullPath;
      pkgV.str = pkgV.dist.str;
      pkgV.json = metaJson;
    }

    if (!item.parent) {
      pkgV.top = true;
    }

    if (item.dsrc === "opt") {
      pkgV.preInstalled = true;
      if (item.optFailed) pkgV.optFailed = true;
    }

    //
    // Follow dependencies regardless if pkg has been resolved because
    // there may be a different request path that lead to this same
    // package version being resolved, so want to include all request paths.
    //
    if (!item.optFailed) {
      if (metaJson.deprecated) pkgV.deprecated = metaJson.deprecated;
      this.addDepOfDep(meta.versions[resolved], item);
      item.addRequestToPkg(pkgV, firstSeen);
      item.addResolutionToParent(this._data);
    }
  }

  addKnownRSemver(kpkg, item, resolved) {
    const check = (exist, msg) => {
      assert(
        exist === resolved,
        `${msg} version ${exist} for ${item.name}@${item.semver} doesn't match ${resolved}`
      );
    };

    const lockRsv = kpkg[LOCK_RSEMVERS];
    const rsv = kpkg[RSEMVERS];

    if (rsv[item.semver]) {
      check(rsv[item.semver], "already resolved");
    } else {
      if (lockRsv && lockRsv[item.semver]) {
        const lockV = lockRsv[item.semver];
        if (lockV !== resolved) {
          logger.info(
            `locked version ${lockV} for ${item.name}@${
              item.semver
            } doesn't match resolved version ${resolved} - updating.`
          );
        }
      }

      rsv[item.semver] = resolved;
    }

    const rversions = kpkg[RVERSIONS];
    if (rversions.indexOf(resolved) < 0) {
      //
      // Descending ordered insertion
      //
      let rvX = 0;
      for (rvX; rvX < rversions.length; rvX++) {
        if (Semver.gt(resolved, rversions[rvX])) break;
      }
      rversions.splice(rvX, 0, resolved);
    }
  }

  resolvePackage(item, meta, topKnownOnly) {
    const kpkg = this._data.getPkg(item); // known package

    const getKnownSemver = () => {
      if (!kpkg) return false;
      const find = rsv => rsv && rsv[item.semver];
      const resolved = find(kpkg[LOCK_RSEMVERS]) || find(kpkg[RSEMVERS]);
      // if (resolved) {
      //   logger.log("found", item.name, item.semver, "already resolved to", resolved);
      // }
      return resolved;
    };

    const searchKnown = () => {
      //
      // Search already known versions from top dep
      //
      if (!kpkg) return false;
      const rversions = kpkg[RVERSIONS];

      if (rversions.length > 0) {
        if (topKnownOnly) {
          return _.find(rversions, v => {
            if (kpkg[v] && kpkg[v].top) return Semver.satisfies(v, item.semver);
          });
        }

        return _.find(rversions, v => Semver.satisfies(v, item.semver));
      }

      // if (resolved) {
      //   logger.log("found known version", resolved, "that satisfied", item.name, item.semver);
      // }

      return false;
    };

    const searchMeta = () => {
      //
      // This sorting and semver searching is the most expensive part of the
      // resolve process, so caching them is very important for performance.
      //
      if (!meta[SORTED_VERSIONS]) {
        meta[SORTED_VERSIONS] = Object.keys(meta.versions).sort(simpleSemverCompare);
      }

      const find = versions => versions && _.find(versions, v => Semver.satisfies(v, item.semver));

      const resolved = find(meta[LOCK_SORTED_VERSIONS]) || find(meta[SORTED_VERSIONS]);
      // logger.log("found meta version", resolved, "that satisfied", item.name, item.semver);

      return resolved;
    };

    const resolved =
      getKnownSemver() ||
      searchKnown() ||
      this.findVersionFromDistTag(meta, item.semver) ||
      (meta && searchMeta());

    // logger.log("resolved to ", resolved, item.name, item.semver);

    return resolved;
  }

  _resolveWithMeta(item, meta, force) {
    const resolved = this.resolvePackage(item, meta, true);

    if (!resolved) {
      if (!force) return false;
      throw new Error(`No version of ${item.name} satisfied semver ${item.semver}`);
    }

    const kpkg = this._data.getPkg(item); // known package

    if (kpkg) {
      this.addKnownRSemver(kpkg, item, resolved);
    }

    this.addPackageResolution(item, meta, resolved);

    return true;
  }

  _resolveWithLockData(item) {
    //
    // Force resolve from lock data in regen mode if item was not a direct
    // optional dependency.
    //
    const force = this._regenOnly && item.dsrc !== "opt";

    const locked = this._fyn.depLocker.convert(item);
    if (locked) {
      return this._resolveWithMeta(item, locked, force);
    }

    if (force) {
      throw new Error(`No version of ${item.name} from lock data satisfied semver ${item.semver}`);
    }

    // unable to resolve with lock data
    return false;
  }

  processItem(item) {
    // always fetch the item and let pkg src manager deal with caching
    return Promise.try(() => this._resolveWithLockData(item)).then(r => {
      if (r || this._regenOnly) return;
      return this._pkgSrcMgr.fetchMeta(item).then(meta => {
        meta = this._fyn.depLocker.update(item, meta);
        // logger.log("resolving for", item.name, item.semver, "with src mgr meta");
        return this._resolveWithMeta(item, meta, true);
      });
    });
  }
}

module.exports = PkgDepResolver;
