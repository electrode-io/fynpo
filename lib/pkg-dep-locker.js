"use strict";

const Fs = require("fs");
const _ = require("lodash");
const simpleSemverCompare = require("./util/simple-semver-compare");
const Yaml = require("js-yaml");
const { DIST_TAGS, RSEMVERS } = require("./symbols");
const logger = require("./logger");

class PkgDepLocker {
  constructor(regenOnly) {
    this._regenOnly = regenOnly;
    this._lockData = {};
  }

  get data() {
    return this._lockData;
  }

  _sortObjKeys(obj) {
    const sorted = {};
    Object.keys(obj)
      .sort()
      .forEach(k => (sorted[k] = obj[k]));
    return sorted;
  }

  //
  // generate lock data from dep data
  //
  generate(depData) {
    //
    // expect package names already sorted in depData
    //
    const lockData = (this._lockData = {});
    _.each(depData.pkgs, (pkg, name) => {
      const versions = Object.keys(pkg).sort(simpleSemverCompare);
      const _dtags = this._sortObjKeys(pkg[DIST_TAGS]);
      const _semvers = this._sortObjKeys(pkg[RSEMVERS]);
      const pkgLock = (lockData[name] = { _dtags, _semvers });
      _.each(versions, version => {
        const vpkg = pkg[version];
        const json = vpkg.json || {};
        const meta = {
          dist: vpkg.dist || {}
        };
        if (json.dependencies) meta.dependencies = json.dependencies;
        if (json.optionalDependencies) meta.optionalDependencies = json.optionalDependencies;
        if (json.peerDependencies) meta.peerDependencies = json.peerDependencies;
        const bd = json.bundleDependencies || json.bundledDependencies;
        if (bd) meta.bundleDependencies = bd;
        pkgLock[version] = meta;
      });
    });
  }

  //
  // save
  //
  save(filename) {
    if (!this._regenOnly) {
      logger.log("saving lock file", filename);
      Fs.writeFileSync(filename, Yaml.dump(this._lockData));
    }
  }

  read(filename) {
    try {
      const data = Fs.readFileSync(filename).toString();
      this._lockData = Yaml.safeLoad(data);
    } catch (err) {
      this._lockData = {};
    }
  }
}

module.exports = PkgDepLocker;
