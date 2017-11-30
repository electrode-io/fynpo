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

const RSEMVERS = Symbol("rsemvers");
const SORTED_VERSIONS = Symbol("sorted versions");

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
  //
  promotePackages() {
    let version;

    const names = Object.keys(this._data.pkgs);

    names.forEach(name => {
      const pkg = this._data.pkgs[name];
      // sort versions from newest to oldest
      const versions = Object.keys(pkg).sort(Semver.rcompare);
      // there's only one version, auto protomote
      if (versions.length === 1) {
        version = versions[0];
      } else {
        const src = versions.map(v => ({ v, s: pkg[v].src }));
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
      kpkg = this._data.pkgs[item.name] = { [RSEMVERS]: {} };
    }

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

    kpkg[RSEMVERS][item.semver] = resolved;

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
    const kpkg = this._data.pkgs[item.name]; // known package

    let resolved =
      (kpkg && kpkg[RSEMVERS][item.semver]) || this.findVersionFromDistTag(meta, item.semver);

    if (!resolved) {
      //
      // This sorting and semver searching is the most expensive part of the
      // resolve process, so caching them is very important for performance.
      //
      if (!meta[SORTED_VERSIONS]) {
        meta[SORTED_VERSIONS] = Object.keys(meta.versions).sort(Semver.rcompare);
      }

      resolved = _.find(meta[SORTED_VERSIONS], v => {
        return Semver.satisfies(v, item.semver);
      });

      if (!resolved) {
        throw new Error(`No version of ${item.name} satisfied semver ${item.semver}`);
      }
    }

    this.addPackageResolution(item, meta, resolved);
  }

  processItem(item) {
    // always fetch the item and let pkg src manager deal with caching
    if (!item) return Promise.resolve();
    return this._pkgSrcMgr.fetchMeta(item).then(meta => this.resolvePackage(item, meta));
  }
}

module.exports = PkgDepResolver;
