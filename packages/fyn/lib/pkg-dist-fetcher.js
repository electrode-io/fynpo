"use strict";

/* eslint-disable no-magic-numbers */

const _ = require("lodash");
// const Fs = require("fs");
const Promise = require("bluebird");
// const Path = require("path");
// const request = require("request");
const logger = require("./logger");
const assert = require("assert");
const PkgDistExtractor = require("./pkg-dist-extractor");
const PromiseQueue = require("./util/promise-queue");

class PkgDistFetcher {
  constructor(options) {
    assert(options && options.data, "Must provide options and options.data");
    this._data = options.data;
    this._packages = {};
    this._pkgSrcMgr = options.pkgSrcMgr;
    this._grouping = {
      need: [],
      optional: [],
      byOptionalParent: []
    };
    this._distExtractor = new PkgDistExtractor({ fyn: options.fyn });
    this._promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this._promiseQ = new PromiseQueue({
      processItem: x => this.fetchItem(x)
    });
    this._promiseQ.on("doneItem", x => this.handleItemDone(x));
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("fail", data => this._reject(data.error));
  }

  wait() {
    return this._promise.then(() => this._distExtractor.wait());
  }

  start() {
    _.each(this._data.pkgs, (pkg, name) => {
      _.each(pkg, (vpkg, version) => {
        vpkg = Object.assign({ name, version }, vpkg);
        const id = `${name}@${version}`;
        this._packages[id] = vpkg;
        if (vpkg.dsrc === "opt") {
          // only needed optionally
          return this._grouping.optional.push(id);
        } else if (vpkg.src === "opt") {
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
    const itemQ = this._grouping.need
      .concat(this._grouping.optional)
      .concat(this._grouping.byOptionalParent);
    this._promiseQ.setItemQ(itemQ);
  }

  done(data) {
    logger.log("done fetch dist", data.totalTime / 1000);
    this._resolve();
  }

  handleItemDone(data) {
    if (!data.error) {
      this._distExtractor.addPkgDist({ pkg: data.res.pkg, fullTgzFile: data.res.fullTgzFile });
    }
  }

  fetchItem(item) {
    const pkg = this._packages[item];
    const pkgName = `${pkg.name}@${pkg.version}`;

    const r = this._pkgSrcMgr.fetchTarball(pkg);
    // const id = `${pkg.name}@${pkg.version}-${r.startTime}`;
    return r.promise.then(() => ({ fullTgzFile: r.fullTgzFile, pkg })).catch(err => {
      logger.log(`fetch '${pkgName}' failed`, err);
      throw err;
    });
  }
}

module.exports = PkgDistFetcher;
