"use strict";

/* eslint-disable max-statements */

/**
 * Before linking a local dep, go into its dir and run fyn install
 *
 * - TODO: impl timestamp check so if no files updated then don't run
 */

const Path = require("path");
const logger = require("./logger");
const PromiseQueue = require("./util/promise-queue");
const VisualExec = require("visual-exec");
const xaa = require("xaa");

class LocalPkgBuilder {
  constructor(options) {
    this._options = options;
    this._fyn = options.fyn;
  }

  async start() {
    this._promiseQ = new PromiseQueue({
      concurrency: 1,
      stopOnError: false,
      processItem: x => this.processItem(x)
    });

    const { localsByDepth } = this._options;

    const addItem = async item => {
      const checkPkg = await this._fyn.getLocalPkgInstall(item.fullPath);

      // TODO: if one of its deps is a local and needed install, then it'd
      // need to be installed also, even if its own files didn't change.
      // Generally this is unnecessary, except if its build process may
      // depend on that downstream local package.
      if (!checkPkg.install) {
        logger.debug(`local pkg at ${item.fullPath} doesn't need build`, checkPkg);
        return;
      }

      if (checkPkg.pkgJson.name === this._fyn._pkg.name) {
        logger.debug(`local pkg at ${item.fullPath} is self, skipping build`);
        return;
      }

      logger.debug(`building local pkg at ${item.fullPath}`, checkPkg, this._fyn._installConfig);

      this._promiseQ.addItem(item);

      if (!this._defer || !this._pending) {
        this._defer = xaa.makeDefer();
        const doneCb = () => {
          if (!this._promiseQ.isPending) {
            this._pending = false;
            this._defer.resolve();
          }
        };
        const failCb = data => {
          this._pending = false;
          this._defer.reject(data.error);
        };
        this._promiseQ.removeListener("done", doneCb);
        this._promiseQ.removeListener("fail", failCb);
        this._promiseQ.on("done", doneCb);
        this._promiseQ.on("fail", failCb);
      }

      this._pending = true;
    };

    for (const locals of localsByDepth.reverse()) {
      for (const item of locals) {
        await addItem(item);
      }
    }
  }

  waitForDone() {
    return this._defer && this._defer.promise;
  }

  processItem(item) {
    const dispPath = Path.relative(this._options.fyn._cwd, item.fullPath);
    const exe = process.argv.slice(0, 2).join(" "); // eslint-disable-line
    const ve = new VisualExec({
      displayTitle: `building local pkg at ${dispPath}`,
      cwd: item.fullPath,
      command: `${exe} -q d --pg simple --no-build-local`,
      visualLogger: logger
    });

    ve.logFinalOutput = () => {};
    return ve.execute();
  }
}

exports.LocalPkgBuilder = LocalPkgBuilder;
