"use strict";

/* eslint-disable no-magic-numbers */

const _ = require("lodash");
const Fs = require("./util/file-ops");
const logger = require("./logger");
const PkgDistExtractor = require("./pkg-dist-extractor");
const PromiseQueue = require("./util/promise-queue");
const chalk = require("chalk");
const longPending = require("./long-pending");
const logFormat = require("./util/log-format");
const { FETCH_PACKAGE, spinner } = require("./log-items");
const hardLinkDir = require("./util/hard-link-dir");
const DepItem = require("./dep-item");
const { MARK_URL_SPEC } = require("./constants");
const EventEmitter = require("events");

const WATCH_TIME = 2000;

class PkgDistFetcher {
  constructor(options) {
    this._packages = {};
    this._pkgSrcMgr = options.pkgSrcMgr;
    this._grouping = {
      need: [],
      optional: [],
      byOptionalParent: []
    };
    this._startTime = null;
    this._fyn = options.fyn;
    this._promiseQ = new PromiseQueue({
      concurrency: this._fyn.concurrency,
      stopOnError: true,
      watchTime: WATCH_TIME,
      processItem: x => this.fetchItem(x)
    });
    this._promiseQ.on("watch", items => longPending.onWatch(items));
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("doneItem", x => this.handleItemDone(x));
    this._promiseQ.on("failItem", x => this.handleItemFail(x));
    // down stream extractor
    this._distExtractor = new PkgDistExtractor({ fyn: options.fyn });
    // immediately stop if down stream extractor failed
    this._distExtractor.once("fail", () => this._promiseQ.setItemQ([]));
  }

  async wait() {
    try {
      await this._promiseQ.wait();
      await this._distExtractor.wait();

      if (this._startTime) {
        const time = logFormat.time(Date.now() - this._startTime);
        logger.info(`${chalk.green("done loading packages")} ${time}`);
      }
    } catch (err) {
      // TODO: should interrupt and stop dist exractor
      throw err;
    }
  }

  addSinglePkg(data) {
    this._addLogItem();
    const id = logFormat.pkgId(data.pkg);
    this._packages[id] = data;
    const stopOnError = !data.optional;
    this._promiseQ.addItem(id, undefined, stopOnError);
  }

  _addLogItem() {
    logger.addItem({ name: FETCH_PACKAGE, color: "green", spinner });
  }

  start(data) {
    this._addLogItem();
    this._startTime = Date.now();
    _.each(data.getPkgsData(), (pkg, name) => {
      _.each(pkg, (vpkg, version) => {
        const id = logFormat.pkgId(name, version);
        this._packages[id] = { pkg: vpkg };
        if (vpkg.dsrc && vpkg.dsrc.includes("opt")) {
          // only needed optionally
          return this._grouping.optional.push(id);
        } else if (vpkg.src && vpkg.src.includes("opt")) {
          // only needed by a parent that's needed optionally
          return this._grouping.byOptionalParent.push(id);
        } else {
          const byOptionalParent = !vpkg.requests.find(r => !_.last(r).startsWith("opt;"));
          if (byOptionalParent) {
            return this._grouping.byOptionalParent.push(id);
          }
        }
        return this._grouping.need.push(id);
      });
    });
    const itemQ = this._grouping.need // first fetch all the needed deps (dep/dev)
      .concat(this._grouping.optional) // then the optional deps
      .concat(this._grouping.byOptionalParent); // then deps pulled by an opt dep
    this._promiseQ.addItems(itemQ);
  }

  done() {
    logger.removeItem(FETCH_PACKAGE);
    if (this._startTime) {
      const time = logFormat.time(Date.now() - this._startTime);
      logger.info(`${chalk.green("packages fetched")} (part of loading) ${time}`);
    }
  }

  isPending() {
    return this._promiseQ.isPending || this._distExtractor.isPending();
  }

  handleItemDone(data) {
    const result = _.get(data, "res.result");

    const { item } = data;
    const itemData = _.pick(this._packages[item], "listener");

    if (!result) {
      if (itemData.listener) {
        itemData.listener.emit("done");
      }
    } else {
      const pkg = _.get(data, "res.pkg");
      this._distExtractor.addPkgDist(Object.assign({ pkg, result }, itemData));
    }
  }

  handleItemFail(data) {
    const { item } = data;
    const itemData = this._packages[item];

    if (itemData.listener) {
      itemData.listener.emit("fail");
    }
  }

  async _hardlinkPackage(pkg, dir) {
    const dist = pkg.dist || {};
    const tarball = dist.tarball || "";
    if (dist.integrity || !tarball.startsWith(MARK_URL_SPEC)) return false;

    // extract info from tarball string
    const info = JSON.parse(tarball.substr(MARK_URL_SPEC.length));
    if (!info.urlType.startsWith("git")) return false;

    let srcDir = dist.fullPath;

    if (!srcDir) {
      // no temp dir with the remote package retrieve, probably loaded from lockfile?
      // fetch manifest with spec info extracted
      const depItem = new DepItem({ name: pkg.name, semver: info.semver });
      const meta = await this._pkgSrcMgr.fetchUrlSemverMeta(depItem);
      srcDir = meta.urlVersions[info.semver].dist.fullPath;
    }

    const destDir = dir || this._fyn.getInstalledPkgDir(pkg.name, pkg.version, pkg);

    await hardLinkDir.link(srcDir, destDir, { sourceMaps: this._fyn._options.sourceMaps });
    await Fs.$.rimraf(srcDir);

    return true;
  }

  async fetchItem(item) {
    const { pkg } = this._packages[item];

    if (pkg.local) return undefined;

    const json = await this._fyn.ensureProperPkgDir(pkg);

    // valid json read from pkg dir, assume previous installed node_modules, do nothing
    if (json) return {};

    // fetch package tarball
    try {
      if (await this._hardlinkPackage(pkg)) {
        return {};
      } else {
        const result = await this._pkgSrcMgr.fetchTarball(pkg);
        return { result, pkg };
      }
    } catch (err) {
      const pkgName = logFormat.pkgId(pkg);
      logger.debug(`dist-fetcher fetch ${pkgName} tarball failed`, chalk.red(err.message));
      logger.debug("STACK", err.stack);
      throw err;
    }
  }

  /**
   * Check if pkg already has a copy extracted to node_modules
   * @param {*} pkg - package info
   * @returns {*} pkg in FV_DIR and its package.json
   */
  async findPkgInNodeModules(pkg) {
    const { name, version } = pkg;
    const result = {
      foundAtTop: false,
      search: []
    };

    const find = async promoted => {
      const existDir = this._fyn.getInstalledPkgDir(name, version, { promoted });
      const x = { dir: existDir };
      result.search.push(x);

      try {
        const pkgJson = await this._fyn.loadJsonForPkg(pkg, existDir, true);
        x.pkgJson = pkgJson;
        if (!pkgJson._invalid) {
          result.existDir = existDir;
          result.pkgJson = pkgJson;
          return true;
        } else if (pkgJson.name && promoted && pkg.promoted) {
          // actually found a package.json file at top, so need to force
          // extracting it to __fv_, and get it to the right place later after
          // all resolve are done.
          result.foundAtTop = true;
        }
      } catch (err) {
        //
      }

      return false;
    };

    if (this._fyn.isNormalLayout) {
      // check if a copy already exist at top
      if (await find(true)) {
        return result;
      }
    }

    await find(false);

    return result;
  }

  //
  // Handles putting pkg into node_modules/${FV_DIR}/${version}/${pkgName}
  //
  async putPkgInNodeModules(pkg, check, optional) {
    const find = check ? await this.findPkgInNodeModules(pkg) : {};
    if (find && find.pkgJson) {
      pkg.extracted = find.existDir;
      return find.pkgJson;
    }

    // TODO: check if version is a symlink and create a symlink
    // hardlink to local package
    if (pkg.local === "hard" && (await this._hardlinkPackage(pkg, find.existDir))) {
      return find.pkgJson;
    }

    // finally fetch tarball and extract

    const listener = new EventEmitter();
    return await new Promise((resolve, reject) => {
      listener.once("done", resolve);
      listener.once("fail", reject);
      this.addSinglePkg({
        pkg,
        listener,
        foundAtTop: find.foundAtTop,
        optional
      });
    });
  }
}

module.exports = PkgDistFetcher;
