"use strict";

/*
 * Dependencies Data
 *
 * Class to contain the entire dependencies tree after
 * fetching meta data and resolve each package's
 * dependencies.
 *
 * fields:
 *
 * - pkgs - The dependency tree
 * - res - The dependency resolution for top level
 *
 */
class DepData {
  constructor(data) {
    data = data || {};
    this.pkgs = data.pkgs || {};
    this.badPkgs = {};
    this.res = data.res || {};
  }

  sortPackagesByKeys() {
    const pkgs = this.pkgs;
    this.pkgs = {};
    Object.keys(pkgs)
      .sort()
      .forEach(x => (this.pkgs[x] = pkgs[x]));
  }

  cleanLinked() {
    this.eachVersion(pkg => {
      pkg.linked = 0;
    });
  }

  getPkgsData(bad) {
    return bad ? this.badPkgs : this.pkgs;
  }

  getPkg(item) {
    return this.getPkgsData(item.optFailed)[item.name];
  }

  eachVersion(cb) {
    const pkgs = this.pkgs;
    Object.keys(pkgs).forEach(x => {
      const pkg = pkgs[x];
      Object.keys(pkg).forEach(v => {
        cb(pkg[v], v, pkg);
      });
    });
  }
}

module.exports = DepData;
