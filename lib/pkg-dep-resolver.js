"use strict";

/* eslint-disable no-magic-numbers */

const _ = require("lodash");
const Semver = require("semver");
const logger = require("./logger");
const DepItem = require("./dep-item");
// const DepData = require("./dep-data");
const PromiseQueue = require("./util/promise-queue");
const PkgOptResolver = require("./pkg-opt-resolver");
const defer = require("./util/defer");

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
        .concat(mapTopDep(pkg.peerDependencies, "per"))
    });
    this._defer = defer();
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("fail", data => this._defer.reject(data.error));
    this._optResolver = new PkgOptResolver({ fyn: this._fyn, depResolver: this });
  }

  start() {
    this._promiseQ._process();
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
  //
  promotePackages() {
    const names = Object.keys(this._data.pkgs);
    names.forEach(name => {
      const pkg = this._data.pkgs[name];
      // sort versions from newest to oldest
      const versions = Object.keys(pkg).sort(Semver.rcompare);
      // there's only one version, auto protomote
      if (versions.length === 1) {
        pkg[versions[0]].promoted = true;
      } else {
        const src = versions.map(v => ({ v, s: pkg[v].src }));
        // find the first source that's not empty
        const bySrc = _.first(
          ["dep", "dev", "opt"]
            .map(s => src.filter(x => x.s.indexOf(s) >= 0))
            .filter(x => x.length > 0)
        );
        // promote latest version
        pkg[bySrc[0].v].promoted = true;
      }
    });
  }

  done(data) {
    if (this._optResolver.isEmpty()) {
      logger.log("done", data.totalTime / 1000);
      this._data.sortPackagesByKeys();
      this.promotePackages();
      this._defer.resolve();
    } else {
      this._optResolver.resolve();
    }
  }

  addDepOfDep(mPkg, parent) {
    const add = (dep, src) => {
      for (const name in dep) {
        const opt = { name, semver: dep[name], src: parent.src, dsrc: src };
        this._promiseQ.addItem(new DepItem(opt, parent));
      }
    };

    add(mPkg.dependencies, "dep");
    add(mPkg.optionalDependencies, "opt");
    add(mPkg.peerDependencies, "per");
  }

  findVersionFromDistTag(meta, semver) {
    if (Semver.validRange(semver) === null) {
      if (meta["dist-tags"].hasOwnProperty(semver)) {
        return meta["dist-tags"][semver];
      }
    }
    return undefined;
  }

  addPackageResolution(item, meta, resolved) {
    item.resolved = resolved;
    // specified as optionalDependencies
    // add to opt resolver to resolve later
    if (item.dsrc === "opt" && !item.optChecked) {
      this._optResolver.add({ item, meta });
      return;
    }
    let kpkg = this._data.pkgs[item.name];
    if (!kpkg) {
      kpkg = this._data.pkgs[item.name] = {};
    }
    let pkgV = kpkg[resolved];
    if (!pkgV) {
      pkgV = kpkg[resolved] = {
        [item.src]: 0,
        requests: [],
        src: item.src,
        dsrc: item.dsrc,
        dist: meta.versions[resolved].dist,
        res: {}
      };
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

  resolvePackage(item, meta) {
    const distTagVer = this.findVersionFromDistTag(meta, item.semver);
    if (distTagVer !== undefined) {
      this.addPackageResolution(item, meta, distTagVer);
      return;
    }
    const versions = Object.keys(meta.versions).sort(Semver.rcompare);
    const fver = versions.find(v => {
      if (Semver.satisfies(v, item.semver)) {
        this.addPackageResolution(item, meta, v);
        return true;
      }
      return false;
    });
    if (!fver) {
      throw new Error(`No version of ${item.name} satisfied semver ${item.semver}`);
    }
  }

  processItem(item) {
    // always fetch the item and let pkg src manager deal with caching
    return this._pkgSrcMgr.fetchMeta(item).then(meta => this.resolvePackage(item, meta));
  }
}

module.exports = PkgDepResolver;
