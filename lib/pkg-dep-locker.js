"use strict";

const assert = require("assert");
const Fs = require("fs");
const _ = require("lodash");
const simpleSemverCompare = require("./util/simple-semver-compare");
const Yaml = require("js-yaml");
const { LOCK_RSEMVERS, RSEMVERS, SORTED_VERSIONS, LOCK_SORTED_VERSIONS } = require("./symbols");
const logger = require("./logger");

class PkgDepLocker {
  constructor(regenOnly) {
    this._regenOnly = regenOnly;
    this._lockData = {};
    this._isFynFormat = true;
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
    this._isFynFormat = true;
    const lockData = (this._lockData = {});
    const genFrom = pkgsData => {
      _.each(pkgsData, (pkg, name) => {
        const versions = Object.keys(pkg).sort(simpleSemverCompare);
        let _semvers = _.transform(
          pkg[RSEMVERS],
          (a, v, k) => {
            if (a[v]) a[v].push(k);
            else a[v] = [k];
            return a;
          },
          {}
        );
        _semvers = _.transform(
          _semvers,
          (a, v, k) => {
            a[v.sort().join(",")] = k;
            return a;
          },
          {}
        );
        const pkgLock = (lockData[name] = { _: this._sortObjKeys(_semvers) });
        _.each(versions, version => {
          const vpkg = pkg[version];
          const json = vpkg.json || {};
          const meta = {
            dist: vpkg.dist || {}
          };
          if (vpkg.top) meta.top = true;
          if (vpkg.optFailed) meta.optFailed = true;
          if (json.dependencies) meta.dependencies = json.dependencies;
          if (json.optionalDependencies) meta.optionalDependencies = json.optionalDependencies;
          if (json.peerDependencies) meta.peerDependencies = json.peerDependencies;
          const bd = json.bundleDependencies || json.bundledDependencies;
          if (bd) meta.bundleDependencies = bd;
          pkgLock[version] = meta;
        });
      });
    };

    genFrom(depData.getPkgsData());
    genFrom(depData.getPkgsData(true));
  }

  //
  // Take dep-item <item> with its real <meta> and update lock data
  //
  update(item, meta) {
    let locked = this._lockData[item.name];
    if (!locked) return meta;

    //
    // Add versions from <meta>
    //

    this._isFynFormat = false;

    if (!locked.hasOwnProperty(LOCK_SORTED_VERSIONS)) {
      locked = this.convert(item) || this._lockData[item.name];
    }

    _.defaults(locked.versions, meta.versions);
    const versions = Object.keys(locked.versions);
    locked[SORTED_VERSIONS] = versions.sort(simpleSemverCompare);
    locked["dist-tags"] = meta["dist-tags"];

    return locked;
  }

  //
  // convert from fyn lock format to npm meta format
  //
  convert(item) {
    let locked = this._lockData[item.name];
    if (!locked) return false;
    let valid = true;

    if (!locked.hasOwnProperty(LOCK_SORTED_VERSIONS)) {
      this._isFynFormat = false;
      const sorted = Object.keys(locked)
        .filter(x => !x.startsWith("_"))
        .sort(simpleSemverCompare);
      const versions = {};
      _.each(sorted, version => {
        const vpkg = locked[version];
        if (!_.isEmpty(vpkg) && vpkg._valid !== false) {
          vpkg.name = item.name;
          vpkg.version = version;
          versions[version] = vpkg;
        } else {
          valid = false;
        }
      });
      const _semvers = _.transform(
        locked._,
        (a, v, k) => {
          k.split(",").forEach(sv => (a[sv] = v));
          return a;
        },
        {}
      );
      locked = this._lockData[item.name] = {
        [LOCK_RSEMVERS]: _semvers,
        [SORTED_VERSIONS]: sorted,
        [LOCK_SORTED_VERSIONS]: sorted,
        versions
      };
    }

    return valid && locked;
  }

  //
  // save
  //
  save(filename) {
    if (!this._regenOnly) {
      assert(this._isFynFormat, "can't save lock data that's no longer in fyn format");
      logger.verbose("saving lock file", filename);
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
