"use strict";

const Fs = require("fs");
const Path = require("path");
const PkgDepResolver = require("./pkg-dep-resolver");
const PkgDistFetcher = require("./pkg-dist-fetcher");
const PkgSrcManager = require("./pkg-src-manager");
const DepData = require("./dep-data");
const fynConfig = require("./fyn-config");
const logger = require("./logger");

class Fyn {
  constructor(options) {
    options = this._options = fynConfig(options);
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

  get pkgSrcMgr() {
    return this._pkgSrcMgr;
  }

  resolveDependencies() {
    this._depResolver = new PkgDepResolver(this._pkg, { fyn: this, data: this._data });
    this._depResolver.start();
    return this._depResolver.wait();
  }

  fetchPackages(data) {
    this._distFetcher = new PkgDistFetcher({
      data: data || this._data || this._depResolver._data,
      pkgSrcMgr: this._pkgSrcMgr,
      fyn: this
    });
    this._distFetcher.start();
    return this._distFetcher.wait().then(() => {
      logger.log("done fetchPackages");
    });
  }

  getInstalledPkgDir(name, version, pkg) {
    return Path.join(this.getOutputDir(), name, pkg.promoted ? "" : `__fv_/${version}`);
  }

  getOutputDir() {
    return Path.join(this._cwd, this._options.targetDir);
  }
}

module.exports = Fyn;
