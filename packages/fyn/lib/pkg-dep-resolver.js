"use strict";

/* eslint-disable no-magic-numbers */

const Promise = require("bluebird");
const _ = require("lodash");
const Semver = require("semver");
const logger = require("./logger");
const DepItem = require("./dep-item");
// const DepData = require("./dep-data");
const PromiseQueue = require("./util/promise-queue");

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
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("fail", data => this._reject(data.error));
  }

  start() {
    this._promiseQ._process();
  }

  wait() {
    return this._promise;
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
    logger.log("done", data.totalTime / 1000);
    this._data.sortPackagesByKeys();
    this.promotePackages();
    this._resolve();
  }

  addDepOfDep(mPkg, parent) {
    const add = (dep, src) => {
      for (const name in dep) {
        this._promiseQ.addItem(
          new DepItem(
            {
              name,
              semver: dep[name],
              src: parent.src,
              dsrc: src
            },
            parent
          )
        );
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

  resolvePackage(item, meta) {
    const resolve = v => {
      item.resolved = v;
      let kpkg = this._data.pkgs[item.name];
      if (!kpkg) {
        kpkg = this._data.pkgs[item.name] = {};
      }
      let pkgV = kpkg[v];
      if (!pkgV) {
        pkgV = kpkg[v] = {
          [item.src]: 0,
          requests: [],
          src: item.src,
          dsrc: item.dsrc,
          dist: meta.versions[v].dist,
          res: {}
        };
        this.addDepOfDep(meta.versions[v], item);
      }
      item.addRequestToPkg(pkgV);
      item.addResolutionToParent(this._data);
    };

    const distTagVer = this.findVersionFromDistTag(meta, item.semver);
    if (distTagVer !== undefined) {
      resolve(distTagVer);
      return;
    }
    const versions = Object.keys(meta.versions).sort(Semver.rcompare);
    const fver = versions.find(v => {
      if (Semver.satisfies(v, item.semver)) {
        resolve(v);
        return true;
      }
      return false;
    });
    if (!fver) {
      throw new Error(`No version of ${item.name} satisfied semver ${item.semver}`);
    }
  }

  //
  // fetch package's meta data
  //
  fetchItem(item) {
    // const pkgName = item.name;

    return this._pkgSrcMgr.fetchMeta(item).then(meta => this.resolvePackage(item, meta));
    // .catch(err => logger.log(`resolve '${pkgName}' failed`, err));
  }

  //
  // check known packages for if a version exist to satisfy name@semver
  // if none exist, then queue up to fetch meta data for package name
  //
  processItem(item) {
    const { name, semver } = item;
    const kpkg = this._data.pkgs[name];
    if (kpkg) {
      const resolveDep = v => {
        item.resolved = v;
        item.addRequestToPkg(kpkg[v]);
        item.addResolutionToParent(this._data);
        return Promise.resolve();
      };
      let foundVer = this.findVersionFromDistTag(this._pkgSrcMgr._meta[name], item.semver);

      if (!foundVer) {
        const versions = Object.keys(kpkg).sort(Semver.rcompare);
        foundVer = versions.find(kver => Semver.satisfies(kver, semver));
      }

      if (kpkg[foundVer]) return resolveDep(foundVer);
    }
    // logger.log(`${name}@${semver} not found, queueing`);
    return this.fetchItem(item);
  }
}

module.exports = PkgDepResolver;
