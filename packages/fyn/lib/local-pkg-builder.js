"use strict";

/* eslint-disable max-statements */

/**
 * Before linking a local dep, go into its dir and run fyn install
 *
 * - TODO: impl timestamp check so if no files updated then don't run
 */

const assert = require("assert");
const Path = require("path");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const VisualExec = require("visual-exec");
const xaa = require("xaa");
const Fs = require("./util/file-ops");
const _ = require("lodash");

class LocalPkgBuilder {
  constructor(options) {
    this._options = options;
    this._fyn = options.fyn;
    this._waitItems = {};
  }

  async start() {
    this._started = xaa.makeDefer();

    this._promiseQ = new PromiseQueue({
      concurrency: 1,
      stopOnError: false,
      processItem: x => this.processItem(x)
    });

    const cliFynJs = Path.join(__dirname, "../cli/fyn.js");
    if (await Fs.exists(cliFynJs)) {
      this._fynJs = cliFynJs;
    } else {
      this._fynJs = Path.join(__dirname, "../bin/fyn.js");
    }

    const { localsByDepth } = this._options;

    this._promiseQ.on("doneItem", data => {
      this._waitItems[data.item.fullPath].resolve();
    });
    this._promiseQ.on("failItem", data => {
      this._waitItems[data.item.fullPath].reject(data.error);
    });

    this._defer = xaa.makeDefer();
    this._promiseQ.on("done", () => {
      if (!this._promiseQ.isPending) {
        this._defer.resolve();
      }
    });
    this._promiseQ.on("fail", data => {
      this._defer.reject(data.error);
    });

    //
    // localsByDepth is array of array: level 1 depths, level 2 packages
    //
    const flatLocals = [].concat(...localsByDepth);
    const allNames = flatLocals.map(x => x.name);

    //
    // convert items into array of names and then use _.uniq to only keep
    // the first occurrence of duplicate names, and reverse them so the
    // ones that has no dependence on the ones before them are build first.
    //
    const uniqNames = _.uniq(allNames).reverse();
    const byName = flatLocals.reduce((a, x) => {
      a[x.name] = x;
      return a;
    }, {});
    logger.debug("local pkgs for build all names", allNames, "uniq names", uniqNames);

    for (const name of uniqNames) {
      await this.addItem(byName[name]);
    }

    logger.debug("resolving build local _started promise");
    this._started.resolve();
  }

  async addItem(item) {
    if (this._waitItems[item.fullPath] !== undefined) {
      logger.debug(`local pkg at ${item.fullPath} already being built`);
      return;
    }

    const checkPkg = await this._fyn.getLocalPkgInstall(item.fullPath);

    this._waitItems[item.fullPath] = false;

    // TODO: if one of its deps is a local and needed install, then it'd
    // need to be installed also, even if its own files didn't change.
    // Generally this is unnecessary, except if its build process may
    // depend on that downstream local package.
    if (!checkPkg.localBuild) {
      logger.debug(`local pkg at ${item.fullPath} doesn't need build`, checkPkg);
      return;
    }

    if (checkPkg.pkgJson.name === this._fyn._pkg.name) {
      logger.debug(`local pkg at ${item.fullPath} is self, skipping build`);
      return;
    }

    logger.debug(
      `building local pkg at ${item.fullPath}`,
      "ctime:",
      checkPkg.ctime,
      "checkCtime",
      checkPkg.checkCtime,
      "stats",
      JSON.stringify(checkPkg.stats, null, 2), // eslint-disable-line
      this._fyn._installConfig
    );

    this._promiseQ.addItem(item);

    this._waitItems[item.fullPath] = xaa.makeDefer();
  }

  async waitForItem(fullPath) {
    if (this._waitItems[fullPath] === undefined) {
      logger.debug("waiting for local build item start, fullPath:", fullPath);
      await this._started.promise;
    }
    const x = this._waitItems[fullPath];
    assert(x !== undefined, `No local pkg build job started for pkg at ${fullPath}`);
    if (x && x.promise) {
      logger.debug("waiting for build local item", fullPath, x);
      await x.promise;
      logger.debug("build local item awaited", fullPath);
    } else {
      logger.debug("status is false => no build local job for pkg at", fullPath, x);
    }
  }

  waitForDone() {
    return this._defer && this._defer.promise;
  }

  processItem(item) {
    const dispPath = Path.relative(this._options.fyn._cwd, item.fullPath);

    const command = [
      process.argv[0],
      this._fynJs,
      this._fyn._options.registry && `--reg=${this._fyn._options.registry}`,
      "-q=d --pg=simple --no-build-local"
    ]
      .filter(x => x)
      .join(" ");

    const ve = new VisualExec({
      displayTitle: `building local pkg at ${dispPath}`,
      cwd: item.fullPath,
      command,
      visualLogger: logger
    });

    ve.logFinalOutput = () => {};
    return ve.execute();
  }
}

exports.LocalPkgBuilder = LocalPkgBuilder;
