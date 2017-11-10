"use strict";

/* eslint-disable */

const Path = require("path");
const LifecycleScripts = require("./life-scripts");

/* Executes lifecycle scripts for packages */

class PkgScriptExecutor {
  constructor(data, options) {
    this._data = data;
  }

  execute(aliases) {
    const installDir = Path.resolve("xout");
    this._data.eachVersion(pkg => {
      const pkgDir = pkg.promoted
        ? Path.join(installDir, pkg.name)
        : Path.join(installDir, pkg.name, "__fv_", pkg.version);
      ls = new LifecycleScripts({ pkgDir });
      ls.execute(aliases);
    });
  }
}

module.exports = PkgScriptExecutor;
