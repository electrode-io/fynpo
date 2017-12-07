"use strict";

/* eslint-disable no-magic-numbers */

const _ = require("lodash");
// const Fs = require("fs");
// const Promise = require("bluebird");
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
    this._fyn = options.fyn;
    this._promiseQ = new PromiseQueue({
      processItem: x => this.fetchItem(x)
    });
    this._promiseQ.on("done", x => this.done(x));
    this._promiseQ.on("doneItem", x => this.handleItemDone(x));
  }

  wait() {
    return this._promiseQ.wait().then(() => this._distExtractor.wait());
  }

  start() {
    _.each(this._data.pkgs, (pkg, name) => {
      _.each(pkg, (vpkg, version) => {
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
  }

  handleItemDone(data) {
    if (!data.error) {
      if (data.res.fullTgzFile) {
        this._distExtractor.addPkgDist({ pkg: data.res.pkg, fullTgzFile: data.res.fullTgzFile });
      }
    } else {
      logger.log("fetch item failed", data.error);
    }
  }

  fetchItem(item) {
    const pkg = this._packages[item];
    const pkgName = `${pkg.name}@${pkg.version}`;

    return this._fyn.readPkgJson(pkg).catch(() => {
      return this._pkgSrcMgr
        .fetchTarball(pkg)
        .then(r => ({ fullTgzFile: r.fullTgzFile, pkg }))
        .catch(err => {
          logger.log(`fetch '${pkgName}' failed`, err);
          throw err;
        });
    });
  }
}

module.exports = PkgDistFetcher;
