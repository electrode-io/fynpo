"use strict";

/* eslint-disable no-magic-numbers */

const Path = require("path");
const crypto = require("crypto");
const assert = require("assert");
const Fs = require("./util/file-ops");
const _ = require("lodash");
const chalk = require("chalk");
const simpleSemverCompare = require("./util/semver").simpleCompare;
const Yaml = require("yamljs");
const sortObjKeys = require("./util/sort-obj-keys");
const {
  LOCK_RSEMVERS,
  RSEMVERS,
  SORTED_VERSIONS,
  LOCK_SORTED_VERSIONS,
  LOCAL_VERSION_MAPS
} = require("./symbols");
const logger = require("./logger");
const fyntil = require("./util/fyntil");

class PkgDepLocker {
  constructor(lockOnly, enableLockfile) {
    this._enable = enableLockfile;
    this._lockOnly = lockOnly;
    this._lockData = {};
    this._isFynFormat = true;
  }

  get data() {
    return this._lockData;
  }

  intFromSha1(ss) {
    if (!ss) return undefined;
    if (ss.startsWith("sha")) return ss;
    return `sha1-${Buffer.from(ss, "hex").toString("base64")}`;
  }

  //
  // generate lock data from dep data
  //
  generate(depData) {
    if (!this._enable) return;
    //
    // expect package names already sorted in depData
    //
    this._isFynFormat = true;
    const lockData = (this._lockData = {});
    const genFrom = pkgsData => {
      _.each(pkgsData, (pkg, name) => {
        const versions = Object.keys(pkg).sort(simpleSemverCompare);
        // collect all semvers that resolved to the same version
        // due to shrinkwrapping, sometimes the same semver could resolve to
        // multiple versions, causing resolved to be an array.
        let _semvers = _.transform(
          pkg[RSEMVERS],
          (a, resolved, semv) => {
            const x = resolved.toString();
            if (a[x]) a[x].push(semv);
            else a[x] = [semv];
            return a;
          },
          {}
        );
        // join the collected semvers by , into a single string and use it as key
        // for the resolved version, and make sure multiple resolved versions
        // are converted back to an array.
        _semvers = _.transform(
          _semvers,
          (a, semv, resolved) => {
            const x = resolved.indexOf(",") > 0 ? resolved.split(",") : resolved.toString();
            a[semv.sort().join(",")] = x;
            return a;
          },
          {}
        );
        const pkgLock = (lockData[name] = { _: sortObjKeys(_semvers) });
        /* eslint-disable complexity, max-statements */
        _.each(versions, version => {
          const vpkg = pkg[version];
          const json = vpkg.json || {};
          const meta = {};
          const dist = vpkg.dist || {};
          if (vpkg.top) meta.top = 1;
          const scripts = json.scripts || {};
          if (vpkg.optFailed) {
            meta.optFailed = 1;
            // no need to remember whether there's preinstall or not if
            // it's already marked as failed.
          } else if (scripts.preinstall || vpkg.hasPI) {
            meta.hasPI = 1;
          }

          if (scripts.install || scripts.postinstall || scripts.postInstall) {
            meta.hasI = 1;
          }

          if (vpkg.local) {
            meta.$ = "local";
            meta._ = dist.fullPath;
          } else {
            meta.$ = dist.integrity || this.intFromSha1(dist.shasum) || 0;
            meta._ = dist.tarball;
          }
          if (!_.isEmpty(json.dependencies)) meta.dependencies = json.dependencies;
          if (!_.isEmpty(json.optionalDependencies)) {
            meta.optionalDependencies = json.optionalDependencies;
          }
          if (!_.isEmpty(json.peerDependencies)) meta.peerDependencies = json.peerDependencies;
          if (vpkg.deprecated) meta.deprecated = vpkg.deprecated;
          const bd = json.bundleDependencies || json.bundledDependencies;
          if (!_.isEmpty(bd)) meta.bundleDependencies = bd;
          if (json.os) meta.os = json.os;
          if (json.cpu) meta.cpu = json.cpu;

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
    if (!this._enable || meta.local) return meta;
    let locked = this._lockData[item.name];
    if (!locked) return meta;

    //
    // Add versions from <meta>
    //

    this._isFynFormat = false;

    if (!locked.hasOwnProperty(LOCK_SORTED_VERSIONS)) {
      locked = this.convert(item) || this._lockData[item.name];
    }

    Object.assign(locked.versions, meta.versions);
    const versions = Object.keys(locked.versions);
    locked[SORTED_VERSIONS] = versions.sort(simpleSemverCompare);
    if (meta.hasOwnProperty(LOCAL_VERSION_MAPS)) {
      locked[LOCAL_VERSION_MAPS] = meta[LOCAL_VERSION_MAPS];
    }
    locked["dist-tags"] = meta["dist-tags"];

    return locked;
  }

  hasLock(item) {
    return Boolean(this._enable && this._lockData[item.name]);
  }

  //
  // convert from fyn lock format to npm meta format
  //
  convert(item) {
    if (!this._enable) return undefined;
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
          if (vpkg.$ === "local") {
            vpkg.local = true;
            vpkg.dist = {
              integrity: "local",
              fullPath: vpkg._
            };
          } else {
            vpkg.dist = {
              integrity: this.intFromSha1(vpkg.$),
              tarball: vpkg._
            };
          }
          vpkg.$ = vpkg._ = null;
          vpkg.fromLocked = true;
          vpkg.name = item.name;
          vpkg.version = version;
          versions[version] = vpkg;
        } else {
          valid = false;
        }
      });
      // separated the semvers joined by , back into individual ones
      // and use them as keys to point to the resolved version.
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

  shasum(data) {
    return crypto
      .createHash("sha1")
      .update(data)
      .digest("hex");
  }

  // convert all local packages paths relative to from
  _relativeLocalPath(from, lockData) {
    _.each(lockData, (pkg, pkgName) => {
      let copied = false;
      Object.keys(pkg).forEach(version => {
        if (version === "_") return;
        const vpkg = pkg[version];
        if (vpkg.$ === "local" && Path.isAbsolute(vpkg._)) {
          if (!copied) lockData[pkgName] = pkg = Object.assign({}, pkg);
          copied = true;
          let relPath = Path.relative(from, vpkg._);
          if (!relPath.startsWith(".")) {
            relPath = `.${Path.sep}${relPath}`;
          }
          pkg[version] = Object.assign({}, vpkg, {
            _: relPath
          });
        }
      });
    });
  }

  // convert all local packages paths to under base
  _fullLocalPath(base, lockData) {
    _.each(lockData || this._lockData, pkg => {
      _.each(pkg, (vpkg, key) => {
        if (key === "_") return;
        if (vpkg.$ === "local" && !Path.isAbsolute(vpkg._)) {
          vpkg._ = Path.join(base, vpkg._);
        }
      });
    });
  }

  //
  // save
  //
  save(filename) {
    if (!this._enable) return;
    if (!Path.isAbsolute(filename)) filename = Path.resolve(filename);
    if (!this._lockOnly) {
      assert(this._isFynFormat, "can't save lock data that's no longer in fyn format");
      const basedir = Path.dirname(filename);
      // sort by package names
      const sortData = sortObjKeys(this._lockData);
      this._relativeLocalPath(basedir, sortData);
      const data = Yaml.stringify(sortData, 4, 1);
      const shaSum = this.shasum(data);
      if (shaSum !== this._shaSum) {
        logger.info("saving lock file", filename);
        Fs.writeFileSync(filename, data);
      } else {
        logger.verbose("lock data didn't change");
      }
    }
  }

  async read(filename) {
    if (!this._enable) return;
    try {
      if (!Path.isAbsolute(filename)) filename = Path.resolve(filename);
      const data = (await Fs.readFile(filename)).toString();
      this._shaSum = this.shasum(data);
      this._lockData = Yaml.parse(data);
      const basedir = Path.dirname(filename);
      this._fullLocalPath(basedir);
      logger.info(chalk.green(`loaded lockfile ${basedir}`));
    } catch (err) {
      if (this._lockOnly) {
        logger.error(`failed to load lockfile ${filename} -`, err.message);
        logger.error("Can't proceed without lockfile in lock-only mode");
        fyntil.exit(err);
      } else {
        logger.debug(`failed to load lockfile ${filename} -`, err.message);
      }
      this._shaSum = Date.now();
      this._lockData = {};
    }
  }
}

module.exports = PkgDepLocker;
