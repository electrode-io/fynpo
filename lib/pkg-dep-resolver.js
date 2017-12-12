"use strict";

/* eslint-disable no-magic-numbers */

const assert = require("assert");
const _ = require("lodash");
const Semver = require("semver");
const logger = require("./logger");
const DepItem = require("./dep-item");
// const DepData = require("./dep-data");
const PromiseQueue = require("./util/promise-queue");
const PkgOptResolver = require("./pkg-opt-resolver");
const defer = require("./util/defer");
const simpleSemverCompare = require("./util/simple-semver-compare");
const { DIST_TAGS, RSEMVERS, LOCK_RSEMVERS, RVERSIONS, SORTED_VERSIONS } = require("./symbols");

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
      // .concat(mapTopDep(pkg.peerDependencies, "per"))
    });
    this._defer = defer();
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("fail", data => this._defer.reject(data.error));
    this._optResolver = new PkgOptResolver({ fyn: this._fyn, depResolver: this });
    this._promiseQ.on("empty", () => {
      this._optResolver.start();
    });
    this._regenOnly = this._fyn.regenOnly;
  }

  start() {
    setTimeout(() => this._promiseQ.addItem(null), 0);
  }

  wait() {
    return this._defer.promise;
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

    const names = Object.keys(this._data.pkgs);

    names.forEach(name => {
      const pkg = this._data.pkgs[name];
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

  done(data) {
    if (!this._optResolver.isEmpty()) {
      this._optResolver.resolve();
    } else {
      logger.log("dep resolver done", data.totalTime / 1000);
      this._data.sortPackagesByKeys();
      this.promotePackages();
      this._defer.resolve();
    }
  }

  resolvePeerDep(depInfo) {
    const json = depInfo.json;
    if (!json) return;
    _.each(json.peerDependencies || json.peerDepenencies, (semver, name) => {
      const resolved = this.resolvePackage({ name, semver });
      if (!resolved) {
        logger.log(
          "Warning: peer dependencies",
          name,
          semver,
          "is missing for",
          depInfo.name,
          depInfo.version
        );
      } else {
        _.set(depInfo, ["res", "dep", name], { resolved });
      }
    });
  }

  addDepOfDep(mPkg, parent) {
    const bundled = mPkg.bundleDependencies;
    const add = (dep, src) => {
      for (const name in dep) {
        if (!bundled || bundled.indexOf(name) < 0) {
          const opt = { name, semver: dep[name], src: parent.src, dsrc: src };
          this._promiseQ.addItem(new DepItem(opt, parent));
        }
      }
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
    add(mPkg.optionalDependencies, "opt");
    // add(mPkg.peerDependencies, "per");
    // logger.log("addDepOfDep Q size", this._promiseQ._itemQ.length);
  }

  findVersionFromDistTag(meta, semver) {
    if (Semver.validRange(semver) === null) {
      if (meta["dist-tags"].hasOwnProperty(semver)) {
        return meta["dist-tags"][semver];
      }
    }
    return undefined;
  }

  /* eslint-disable max-statements */
  addPackageResolution(item, meta, resolved) {
    item.resolve(resolved);

    let pkgV; // specific version of the known package
    let kpkg = this._data.pkgs[item.name]; // known package

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
      kpkg = this._data.pkgs[item.name] = {
        [DIST_TAGS]: meta["dist-tags"],
        [LOCK_RSEMVERS]: meta[LOCK_RSEMVERS],
        [RSEMVERS]: {},
        [RVERSIONS]: []
      };
      this.addKnownRSemver(kpkg, item, resolved);
    }

    if (!pkgV) {
      pkgV = kpkg[resolved] = {
        [item.src]: 0,
        requests: [],
        src: item.src,
        dsrc: item.dsrc,
        dist: meta.versions[resolved].dist,
        name: item.name,
        version: resolved,
        res: {}
      };
    }

    if (meta.local) {
      pkgV.local = true;
      pkgV.dir = pkgV.dist.fullPath;
      pkgV.str = pkgV.dist.str;
      pkgV.json = meta.versions[resolved];
    }

    if (!item.parent) {
      pkgV.top = true;
    }

    if (item.dsrc === "opt") {
      pkgV.preInstalled = true;
    }

    //
    // Follow dependencies regardless if pkg has been resolved because
    // there may be a different request path that lead to this same
    // package version being resolved, so want to include all request paths.
    //
    this.addDepOfDep(meta.versions[resolved], item);
    item.addRequestToPkg(pkgV);
    item.addResolutionToParent(this._data);
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
    } else if (lockRsv && lockRsv[item.semver]) {
      check((rsv[item.semver] = lockRsv[item.semver]), "locked");
    } else {
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
    const kpkg = this._data.pkgs[item.name]; // known package

    const getKnownSemver = () => {
      if (!kpkg) return false;
      const resolved = kpkg[RSEMVERS][item.semver];
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
      const resolved = _.find(rversions, v => {
        if (topKnownOnly && !(kpkg[v] && kpkg[v].top)) return false;
        return Semver.satisfies(v, item.semver);
      });

      // if (resolved) {
      //   logger.log("found known version", resolved, "that satisfied", item.name, item.semver);
      // }

      return resolved;
    };

    const searchMeta = () => {
      //
      // This sorting and semver searching is the most expensive part of the
      // resolve process, so caching them is very important for performance.
      //
      if (!meta[SORTED_VERSIONS]) {
        meta[SORTED_VERSIONS] = Object.keys(meta.versions).sort(simpleSemverCompare);
      }

      const resolved = _.find(meta[SORTED_VERSIONS], v => Semver.satisfies(v, item.semver));
      // logger.log("found meta version", resolved, "that satisfied", item.name, item.semver);

      return resolved;
    };

    return (
      getKnownSemver() ||
      searchKnown() ||
      this.findVersionFromDistTag(meta, item.semver) ||
      (meta && searchMeta())
    );
  }

  _resolveWithMeta(item, meta, force) {
    const resolved = this.resolvePackage(item, meta, true);

    if (!resolved) {
      if (!force) return false;
      throw new Error(`No version of ${item.name} satisfied semver ${item.semver}`);
    }

    const kpkg = this._data.pkgs[item.name]; // known package

    if (kpkg) {
      this.addKnownRSemver(kpkg, item, resolved);
    }

    this.addPackageResolution(item, meta, resolved);

    return true;
  }

  _resolveWithLockData(item) {
    const data = this._fyn.depLocker.data;
    let locked = data[item.name];
    //
    // Force resolve from lock data in regen mode if item was not a direct
    // optional dependency.
    //
    const force = this._regenOnly && item.dsrc !== "opt";

    if (locked) {
      if (!locked.hasOwnProperty(SORTED_VERSIONS)) {
        const sorted = Object.keys(locked)
          .filter(x => !x.startsWith("_"))
          .sort(simpleSemverCompare);
        const versions = {};
        _.each(sorted, version => {
          const vpkg = locked[version];
          vpkg.name = item.name;
          vpkg.version = version;
          versions[version] = vpkg;
        });
        locked = data[item.name] = {
          [LOCK_RSEMVERS]: locked._semvers,
          [SORTED_VERSIONS]: sorted,
          "dist-tags": locked._dtags,
          versions
        };
      }

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
    if (!item || this._resolveWithLockData(item) || this._regenOnly) return Promise.resolve();
    return this._pkgSrcMgr.fetchMeta(item).then(meta => this._resolveWithMeta(item, meta, true));
  }
}

module.exports = PkgDepResolver;
