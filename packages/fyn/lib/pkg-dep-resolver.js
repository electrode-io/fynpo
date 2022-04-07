"use strict";

/* eslint-disable no-magic-numbers, max-params, max-statements, complexity */

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
const createDefer = require("./util/defer");
const simpleSemverCompare = semverUtil.simpleCompare;
const logFormat = require("./util/log-format");
const { LONG_WAIT_META } = require("./log-items");
const { checkPkgOsCpu, relativePath } = require("./util/fyntil");
const { getDepSection, makeDepStep } = require("@fynpo/base");
const xaa = require("./util/xaa");
const { AggregateError } = require("@jchip/error");

const {
  SEMVER,
  RSEMVERS,
  LOCK_RSEMVERS,
  SORTED_VERSIONS,
  LATEST_SORTED_VERSIONS,
  LATEST_VERSION_TIME,
  LOCK_SORTED_VERSIONS,
  LATEST_TAG_VERSION,
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
    // this._optResolver = new PkgOptResolver({ fyn: this._fyn, depResolver: this });
    this._optResolver = options.optResolver;
    this._optResolver._depResolver = this;
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
    const topDepItems = this.makePkgDepItems(
      pkg,
      new DepItem({
        name: "~package.json",
        semver: "-",
        src: "",
        dsrc: "pkg",
        resolved: "~",
        shrinkwrap: options.shrinkwrap,
        // set to zero to que children to take their priorities from their position
        priority: 0
      }),
      !this._fyn.production
    );
    this.addPkgDepItems(topDepItems);
    this._fyn._depLocker.setPkgDepItems(topDepItems);
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
  // any package that only has a single version is promoted to top level for flattening
  // promote priority by src: dep, opt, dev
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
      // there's only one version, auto promote
      if (versions.length === 1) {
        version = versions[0];
      } else if (!(version = _.find(versions, v => pkg[v].top))) {
        // default to promote first seen version
        version = pkg[RESOLVE_ORDER][0];
        // but promote the version with the highest priority
        versions.forEach(x => {
          if (pkg[x].priority > pkg[version].priority) {
            version = x;
          }
        });
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
      const resolved = this.resolvePackage({ item: { name, semver }, meta: {} });
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
    if (!depthInfo) {
      // all dependencies resolved, start local package build if there are any
      if (!this._buildLocal && this._options.buildLocal && !_.isEmpty(this._localsByDepth)) {
        this._buildLocal = this._fyn.createLocalPkgBuilder(this._localsByDepth);
        this._buildLocal.start();
      }
      return;
    }
    this._depthResolving.current = depth;

    const depthPkgs = Object.keys(depthInfo);

    // TODO: create test scenario for build-local
    if (this._options.buildLocal) {
      const locals = depthPkgs.map(x => depthInfo[x].items.find(it => it.localType)).filter(x => x);

      // logger.info("adding depth pkgs", depthPkgs.join(", "), locals);

      if (locals.length > 0) {
        if (!this._localsByDepth) {
          this._localsByDepth = [];
        }
        this._localsByDepth.push(locals);
      }
    }

    depthPkgs.forEach(x => this._promiseQ.addItem(x, true));

    // depth 1 is the dependencies from app's package.json
    if (depth === 1) {
      // check if any dep item changed from lock and remove them in lock data
      // TODO: should this be done for every depth?
      for (const name in depthInfo) {
        depthInfo[name].items.forEach(di => this._fyn._depLocker.remove(di));
      }
    }
    this._promiseQ.addItem(PromiseQueue.pauseItem, true);
    this._promiseQ.addItem({ queueDepth: true, depth: depth + 1 }, true);
    // depthInfo.names = {};
  }

  prefetchMeta(item) {
    // fire-and-forget to retrieve meta
    // if it's not local, doesn't have meta yet, and doesn't have lock data
    if (!item.semverPath && !this._pkgSrcMgr.hasMeta(item) && !this._fyn.depLocker.hasLock(item)) {
      this._pkgSrcMgr.fetchMeta(item).catch(err => {
        logger.warn(`failed prefetch meta for ${item.name}@${item.semver}`, err.message);
      });
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
        //
        // ??? When can a dep pkg can have more than one resolving data item?
        //
        depthData[name].items.push(depItem);
      }
    });
  }

  addPkgDepItems(data) {
    if (data.dep) {
      this.addDepResolving(data.dep);
    }
    if (data.dev) {
      this.addDepResolving(data.dev);
    }
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

  getAutoSemver(semver) {
    const autoSemver = _.get(this._fyn._fynpo, "config.localDepAutoSemver");
    if (autoSemver) {
      const parsedSv = Semver.coerce(semver);
      if (parsedSv && parsedSv.raw) {
        switch (autoSemver) {
          case "patch":
            semver = `~${parsedSv.raw}`;
            break;
          case "minor":
            semver = `^${parsedSv.raw}`;
            break;
          case "major":
            semver = "*";
            break;
        }
      }
    }

    return semver;
  }

  /**
   * create the dep relation items for a package
   *
   * @param {*} pkg - the package
   * @param {*} depItem - the dep relation item for the package, this serves as the parent
   *                      of all the new dep items created
   * @param {*} dev
   * @param {*} noPrefetch
   * @param {*} deepResolve
   * @returns
   */
  makePkgDepItems(pkg, depItem, dev, noPrefetch, deepResolve) {
    const bundled = pkg.bundleDependencies;

    const depPriorities = {
      devopt: 100000000,
      dev: 200000000,
      opt: 800000000,
      dep: 900000000
    };

    const makeDepItems = (deps, dsrc) => {
      const items = [];
      const src = depItem.src || dsrc;
      const depNames = Object.keys(deps);
      for (let idx = 0; idx < depNames.length; idx++) {
        const name = depNames[idx];
        if (!_.includes(bundled, name)) {
          const opt = {
            name,
            priority: depItem.priority || depPriorities[dsrc] - idx,
            semver: deps[name],
            src,
            dsrc,
            deepResolve
          };
          const newItem = new DepItem(opt, depItem);

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

    const findFynpoPkgOfDep = (di, steps) => {
      const fynpoPath = di.fullPath
        ? Path.relative(this._fyn._fynpo.dir, di.fullPath)
        : Path.relative(this._fyn._fynpo.dir, this._fyn.cwd);
      const fynpoPkg = this._fyn._fynpo.graph.packages.byPath[fynpoPath];
      if (fynpoPkg) {
        steps.push(makeDepStep(fynpoPkg.name, fynpoPkg.version, di.dsrc));
        return fynpoPkg;
      }
      if (di.parent) {
        steps.push(makeDepStep(di.name, di.version, di.dsrc));
        return findFynpoPkgOfDep(di.parent, steps);
      }
      return false;
    };

    const joinFynDep = depSec => {
      if (!this._fyn.fynlocal) return pkg[depSec];

      const deps = Object.assign({}, pkg[depSec]);

      const fynDeps = _.get(pkg, ["fyn", depSec], {});
      let fromDir = pkg[PACKAGE_RAW_INFO] && pkg[PACKAGE_RAW_INFO].dir;

      // if in fynpo mode, gather deps that are actually local packages in the monorepo
      if (this._fyn.isFynpo) {
        const locals = [];
        const fynpo = this._fyn._fynpo;
        if (!fromDir) {
          // this case means a downstream pkg has a dep on a monorepo package
          fromDir = this._fyn.cwd;
        }

        for (const name in deps) {
          if (
            this._fyn.checkNoFynLocal(name) ||
            !fynpo.graph.getPackageByName(name) ||
            semverUtil.checkUrl(deps[name])
          ) {
            continue;
          }

          //
          // Check if there is a fynpo package that match 'name@semver'?
          //
          const semver = this.getAutoSemver(deps[name]);
          const fynpoPkg = fynpo.graph.resolvePackage(name, semver, false);

          if (fynpoPkg) {
            locals.push(fynpoPkg);
            const fullPkgDir = Path.join(fynpo.dir, fynpoPkg.path);
            fynDeps[name] = relativePath(fromDir, fullPkgDir, true);
          } else {
            const dispName = logFormat.pkgId(name);
            const versions = fynpo.graph.packages.byName[name].map(x => x.version).join(", ");
            logger.info(
              `No match version in your monorepo found for dependency ${dispName}@${semver}. Versions available: ${versions}`
            );
          }
        }
        if (locals.length > 0 && !this._options.deDuping) {
          const revSteps = [];
          const fynpoPkg = findFynpoPkgOfDep(depItem, revSteps);
          if (fynpoPkg) {
            const steps = revSteps.reverse();
            locals.forEach(x => {
              const sec = getDepSection(depSec);
              if (fynpo.graph.addDep(fynpoPkg, x, sec, steps)) {
                fynpo.indirects.push({
                  fromPkg: _.pick(fynpoPkg, ["name", "version", "path"]),
                  onPkg: _.pick(x, ["name", "version", "path"]),
                  depSection: sec,
                  indirectSteps: steps
                });
              }
            });
          }
          const names = locals.map(x => x.name).join(", ");
          logger.info(
            `Using local copies from your monorepo for these packages in ${pkg.name}'s ${depSec}: ${names}`
          );
        }
      }

      for (const name in fynDeps) {
        if (!fromDir) continue;
        const ownerName = chalk.magenta(depItem.name);
        const dispName = chalk.green(name);
        if (this._fyn.checkNoFynLocal(name)) {
          logger.info(`fyn local disabled for ${dispName} of ${ownerName}`);
          continue;
        }
        if (!deps[name]) {
          logger.warn(`You ONLY defined ${name} in fyn.${depSec}!`);
        }
        const dispSec = chalk.cyan(`fyn.${depSec}`);
        const dispSemver = chalk.blue(fynDeps[name]);
        try {
          Fs.statSync(Path.join(fromDir, fynDeps[name]));
          deps[name] = fynDeps[name];
          if (!this._options.deDuping) {
            logger.verbose(`${dispSec} ${dispName} of ${ownerName} will use`, dispSemver);
          }
        } catch (err) {
          logger.warn(
            `${dispSec} ${dispName} of ${ownerName} not found`,
            chalk.red(err.message),
            "pkg local dir",
            chalk.blue(fromDir),
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
        [LATEST_TAG_VERSION]:
          (meta && meta[LATEST_TAG_VERSION]) || _.get(meta, ["dist-tags", "latest"]),
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
        res: {},
        priority: item.priority
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
      (this._fyn.alwaysFetchDist ||
        (metaJson._hasShrinkwrap && !metaJson._shrinkwrap) ||
        metaJson.bundleDependencies ||
        metaJson.bundledDependencies)
    ) {
      if (metaJson._hasShrinkwrap) pkgV._hasShrinkwrap = metaJson._hasShrinkwrap;
      await this._fyn._distFetcher.putPkgInNodeModules(pkgV, true);
      if (metaJson._hasShrinkwrap) await item.loadShrinkwrap(pkgV.extracted);
      if (metaJson.bundleDependencies || metaJson.bundledDependencies) {
        const found = await xaa.try(async () => {
          const stat = await Fs.stat(Path.join(pkgV.extracted, "node_modules"));
          return stat.isDirectory();
        });
        if (!found) {
          delete metaJson.bundleDependencies;
          delete metaJson.bundledDependencies;
        }
      }
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
        // Alice, do not go down the rabbit hole, it will never end.
        if (!item.isCircular()) {
          pkgDepth.depItems.push(
            this.makePkgDepItems(meta.versions[resolved], item, false, deepRes)
          );
        }
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

  resolvePackage({ item, meta, noLocal, lockOnly }) {
    const latest = meta[LATEST_TAG_VERSION] || _.get(meta, ["dist-tags", "latest"]);
    let latestSatisfied;

    const satisfies = (v, sv) => {
      if (noLocal && semverUtil.isLocal(v)) return false;
      return semverUtil.satisfies(v, sv);
    };

    const checkLatestSatisfy = () => {
      if (latestSatisfied === undefined) {
        // since satisfy means resolve must limit to versions to before latest,
        // if latest is not defined, then consider not satisfy to allow resolving
        // with all available versions
        latestSatisfied = latest ? satisfies(latest, item.semver) : false;
      }
      return latestSatisfied;
    };

    const kpkg = this._data.getPkg(item); // known package
    let foundInKnown;

    const tryYarnLock = () => {
      // is there yarn lock data that we should use?
      if (this._options.yarnLock) {
        const key = `${item.name}@${item.semver}`;
        const fromYarn = this._options.yarnLock[key];
        if (fromYarn) {
          logger.debug(`Resolved ${key} to ${fromYarn.version} from yarn.lock`);
          return fromYarn.version;
        }
      }

      return undefined;
    };

    // check if the same semver has been resolved before
    const getKnownSemver = () => {
      const find = rsv => {
        let x = rsv && rsv[item.semver];
        if (!x) return x;
        if (Array.isArray(x)) x = x[0];
        if (noLocal && semverUtil.isLocal(x)) return false;
        return x;
      };

      const resolved =
        (kpkg && (find(kpkg[LOCK_RSEMVERS]) || find(kpkg[RSEMVERS]))) || find(meta[LOCK_RSEMVERS]);

      foundInKnown = Boolean(resolved);
      return resolved;
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

      foundInKnown = Boolean(resolved);

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

        // sort versions in descending order
        const sorted = Object.keys(meta.versions).sort(simpleSemverCompare);
        // make sure all versions newer than the tagged latest version are not considered
        if (latest && sorted[0] !== latest) {
          if (meta.time && meta.time[latest]) {
            // just need to lock to latest time
            meta[LATEST_VERSION_TIME] = new Date(meta.time[latest]);
          } else {
            // unfortunately, must filter out all versions newer than latest
            meta[LATEST_SORTED_VERSIONS] = sorted.filter(
              v => !semverUtil.isVersionNewer(v, latest)
            );
          }
        }

        meta[SORTED_VERSIONS] = sorted;
      }

      let lockTime = this._fyn.lockTime;
      let sortedVersions = meta[SORTED_VERSIONS];

      // can't consider any versions newer or later than latest if it satisfies the semver
      if (checkLatestSatisfy()) {
        if (meta[LATEST_VERSION_TIME] && (!lockTime || lockTime > meta[LATEST_VERSION_TIME])) {
          // lockTime can't be greater than latest time
          lockTime = meta[LATEST_VERSION_TIME];
        } else if (meta[LATEST_SORTED_VERSIONS]) {
          sortedVersions = meta[LATEST_SORTED_VERSIONS];
        }
      }

      const find = (versions, times, mustUseRealMeta) => {
        if (!versions) return null;
        const countVer = Object.keys(versions).length;

        return _.find(versions, v => {
          if (!satisfies(v, item.semver)) {
            return false;
          }

          if ((!lockTime || !times[v] || countVer < 2) && !mustUseRealMeta) {
            return true;
          }

          if (!times[v]) {
            return false;
          }

          const time = new Date(times[v]);
          if (time > lockTime) {
            // logger.debug("times", times);
            logger.verbose(
              item.name,
              v,
              "time",
              time.toString(),
              "is newer than lock/latest time",
              lockTime.toString()
            );
            return false;
          }

          return true;
        });
      };

      // simply use latest if it satisfies, before searching through all versions
      let resolved = (checkLatestSatisfy() && latest) || find(meta[LOCK_SORTED_VERSIONS], {});
      // if not able to resolve from locked data or it's newer than latest which
      // satisfies the semver, then must resolve again with latest info.
      // must resolve with original real meta
      const mustUseRealMeta =
        checkLatestSatisfy() && resolved && semverUtil.isVersionNewer(resolved, latest);
      if (!resolved || mustUseRealMeta) {
        resolved = find(sortedVersions, meta.time || {}, mustUseRealMeta);
      }

      // logger.log("found meta version", resolved, "that satisfied", item.name, item.semver);

      return resolved;
    };

    const getLocalVersion = () => {
      if (meta.hasOwnProperty(LOCAL_VERSION_MAPS)) {
        logger.debug(
          `meta LOCAL_VERSION_MAPS for ${item.semver} - ${JSON.stringify(meta[LOCAL_VERSION_MAPS])}`
        );
        return meta[LOCAL_VERSION_MAPS][item.semver];
      }
      return false;
    };

    const getUrlVersion = () => {
      return Boolean(meta.urlVersions && item.urlType) && meta.urlVersions[item.semver].version;
    };

    let resolved =
      (!noLocal && getLocalVersion()) ||
      getUrlVersion() ||
      getKnownSemver() ||
      searchKnown() ||
      tryYarnLock();

    if (!resolved) {
      resolved = this.findVersionFromDistTag(meta, item.semver);
    } else if (
      !foundInKnown &&
      checkLatestSatisfy() &&
      semverUtil.isVersionNewer(resolved, latest)
    ) {
      // version was not resolved by a higher level dep (known)
      // and resolution from local or URL is newer than latest, so can't use it
      resolved = false;
    }

    if (!resolved && meta.versions && !lockOnly) {
      resolved = searchMeta();
    }

    // logger.debug("resolved to", resolved, "for", item.name, item.semver);

    // if resolving according to a meta, then make sure it contains the resolved version
    return meta.versions ? meta.versions[resolved] && resolved : resolved;
  }

  _failUnsatisfySemver(item) {
    throw new Error(
      `Unable to find a version from lock data that satisfied semver ${item.name}@${item.semver}
${item.depPath.join(" > ")}`
    );
  }

  _resolveWithMeta({ item, meta, force, noLocal, lockOnly }) {
    let resolved = item.nestedResolve(item.name, item.semver);

    if (resolved) {
      if (!meta.versions.hasOwnProperty(resolved)) {
        resolved = false;
      }
    } else {
      resolved = this.resolvePackage({ item, meta, noLocal, lockOnly });
    }

    if (!resolved) {
      if (!force) return false;
      this._failUnsatisfySemver(item);
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

    const force = this._lockOnly && !isOpt;

    // check if an already resolved local package satisfies item
    // before trying to resolve with lock data
    if (!this._fyn.preferLock) {
      const localMeta = this._pkgSrcMgr.getAllLocalMetaOfPackage(item.name);

      if (localMeta) {
        for (const v in localMeta) {
          const localResolve = this._resolveWithMeta({ item, meta: localMeta[v] });
          if (localResolve) {
            return localResolve;
          }
        }
      }
    }

    const locked = this._fyn.depLocker.convert(item);

    if (locked) {
      const resolved = this._resolveWithMeta({
        item,
        meta: locked,
        force,
        noLocal: !this._fyn.preferLock,
        lockOnly: true
      });
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
      this._failUnsatisfySemver(item);
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
          const updated = this._fyn.depLocker.update(item, meta);
          return this._resolveWithMeta({ item, meta: updated, force: true });
        }
        return false;
      });
    };

    const tryLock = () => {
      return Promise.try(() => {
        const r = this._resolveWithLockData(item);

        if (r) {
          item._resolveByLock = true;
        }

        return r;
      });
    };

    const promise =
      !item.semverPath || this._fyn.preferLock
        ? tryLock().then(r => r || (item.semverPath && tryLocal()))
        : tryLocal().then(r => r || tryLock());

    const failMetaMsg = name =>
      `Unable to retrieve meta for package ${name} - If you've updated its version recently, try to run fyn with '--refresh-meta' again`;

    return promise
      .then(r => {
        if (r && !_.get(r, ["meta", "versions", r.resolved, "_missingJson"])) {
          return r;
        }

        if (this._lockOnly || item.localType) return undefined;
        // neither local nor lock was able to resolve for item
        // so try to fetch from registry for real meta to resolve
        // always fetch the item and let pkg src manager deal with caching
        return this._pkgSrcMgr
          .fetchMeta(item)
          .then(meta => {
            if (!meta) {
              throw new Error(failMetaMsg(item.name));
            }
            const updated = this._fyn.depLocker.update(item, meta);
            return this._resolveWithMeta({ item, meta: updated, force: true, noLocal: true });
          })
          .catch(err => {
            // item is not optional => fail
            if (item.dsrc !== "opt") {
              if (err.message.includes("Unable to retrieve meta")) {
                throw err;
              } else {
                throw new AggregateError([err], failMetaMsg(item.name));
              }
            } else {
              item.resolved = `metaFail_${item.semver}`;
              // add to opt resolver directly as failed package with a dummy meta
              this._optResolver.add({ item, err, meta: { versions: { [item.resolved]: {} } } });
            }
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
