"use strict";

/* eslint-disable */

const Fs = require("fs");
const Path = require("path");
const PkgDepResolver = require("./pkg-dep-resolver");
const PkgDistFetcher = require("./pkg-dist-fetcher");
const PkgSrcManager = require("./pkg-src-manager");
const DepData = require("./dep-data");
const config = require("./fyn-config");

class Fyn {
  constructor(options) {
    options = this._options = Object.assign({}, config, options);
    this._pkgSrcMgr = options.pkgSrcMgr || new PkgSrcManager(options);
    if (options.pkgFile) {
      const pkgFile = Path.resolve(options.pkgFile);
      this._pkgFile = pkgFile;
      this._pkg = JSON.parse(Fs.readFileSync(pkgFile).toString());
    } else {
      this._pkg = options.pkgData;
    }
    this._data = options.data || new DepData();
    this._cwd = options.cwd || process.cwd();
  }

  resolveDependencies() {
    this._depResolver = new PkgDepResolver(this._pkg, { fyn: this, data: this._data });
    this._depResolver.start();
    return this._depResolver.wait();
  }

  fetchPackages(data) {
    this._distFetcher = new PkgDistFetcher({
      data: data || this._data || this._depResolver._data,
      pkgSrcMgr: this._pkgSrcMgr
    });
    this._distFetcher.start();
    return this._distFetcher.wait().then(() => {
      console.log("done fetchPackages");
    });
  }

  getInstalledPkgDir(name, version, pkg) {
    return Path.join(this._cwd, "xout", name, pkg.promoted ? "" : `__fv_/${version}`);
  }

  getOutputDir() {
    return Path.join(this._cwd, "xout");
  }
}

module.exports = Fyn;
