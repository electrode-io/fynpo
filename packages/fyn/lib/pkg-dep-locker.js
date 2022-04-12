"use strict";

/* eslint-disable no-magic-numbers, no-param-reassign */

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
  LATEST_TAG_VERSION,
  LATEST_SORTED_VERSIONS,
  LATEST_VERSION_TIME,
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
    this._config = {};
  }

  get data() {
    return this._lockData;
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
    const lockData = (this._lockData = { $pkg: this._$pkg });
    const genFrom = pkgsData => {
      _.each(pkgsData, (pkg, name) => {
        if (_.isEmpty(pkg)) return;
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
        const pkgLock = lockData[name] || (lockData[name] = {});

        if (pkg[LATEST_TAG_VERSION]) {
          pkgLock._latest = pkg[LATEST_TAG_VERSION];
        }

        pkgLock._ = sortObjKeys({ ...pkgLock._, ..._semvers });

        /* eslint-disable complexity, max-statements */
        _.each(versions, version => {
          const vpkg = pkg[version];
          if (!vpkg) return;
          const json = vpkg.json || {};
          const meta = {};
          const dist = vpkg.dist || {};
          if (vpkg.top) meta.top = 1;
          const scripts = json.scripts || {};
          if (vpkg.optFailed) {
            meta.optFailed = vpkg.optFailed;
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
            meta.$ = fyntil.distIntegrity(dist) || 0;
            meta._ = dist.tarball;
          }

          if (!meta.optFailed) {
            if (_.isEmpty(json)) {
              meta._missingJson = true;
            } else {
              // save dependencies from package.json to meta in lockfile
              if (!_.isEmpty(json.dependencies)) {
                meta.dependencies = json.dependencies;
              }
              if (!_.isEmpty(json.optionalDependencies)) {
                meta.optionalDependencies = json.optionalDependencies;
              }
              if (!_.isEmpty(json.peerDependencies)) {
                meta.peerDependencies = json.peerDependencies;
              }
              const bd = json.bundleDependencies || json.bundledDependencies;
              if (!_.isEmpty(bd)) {
                meta.bundleDependencies = bd;
              }
            }
          }

          if (vpkg.deprecated) meta.deprecated = vpkg.deprecated;
          if (json.os) meta.os = json.os;
          if (json.cpu) meta.cpu = json.cpu;
          if (json._hasShrinkwrap) {
            meta._hasShrinkwrap = 1;
          }

          pkgLock[version] = meta;
        });
      });
    };

    // add lock info for installed packages
    genFrom(depData.getPkgsData());
    // now add lock info for packages that didn't install due to failures (optionalDependencies)
    genFrom(depData.getPkgsData(true));
  }

  //
  // Take dep-item <item> with its real <meta> and update lock data
  //
  update(item, meta) {
    if (!this._enable || meta.local) return meta;
    let locked = this._lockData[item.name];
    if (!locked) {
      return meta;
    }

    //
    // Add versions from <meta>
    //

    this._isFynFormat = false;

    if (!locked.hasOwnProperty(LOCK_SORTED_VERSIONS)) {
      locked = this.convert(item) || this._lockData[item.name];
    }

    Object.assign(locked.versions, meta.versions);
    // const versions = Object.keys(locked.versions);
    // locked[SORTED_VERSIONS] = versions.sort(simpleSemverCompare);
    locked[SORTED_VERSIONS] = undefined;
    locked[LATEST_TAG_VERSION] = undefined;
    locked[LATEST_VERSION_TIME] = undefined;
    locked[LATEST_SORTED_VERSIONS] = undefined;
    if (meta.hasOwnProperty(LOCAL_VERSION_MAPS)) {
      locked[LOCAL_VERSION_MAPS] = meta[LOCAL_VERSION_MAPS];
    }
    locked["dist-tags"] = meta["dist-tags"];
    locked.time = meta.time;

    if (meta.urlVersions) {
      locked.urlVersions = meta.urlVersions;
    }

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
              integrity: fyntil.shaToIntegrity(vpkg.$),
              tarball: vpkg._
            };
          }
          vpkg.$ = vpkg._ = null;
          vpkg.fromLocked = true;
          vpkg.name = item.name;
          vpkg.version = version;
          if (vpkg._hasShrinkwrap) {
            vpkg._hasShrinkwrap = true;
          }
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
        [LATEST_TAG_VERSION]: locked._latest,
        [LOCK_RSEMVERS]: _semvers,
        // [SORTED_VERSIONS]: sorted,
        [LOCK_SORTED_VERSIONS]: sorted,
        versions
      };
    }

    return valid && locked;
  }

  /**
   * Set the package.json's dependencies items and check if they changed from
   * lock data.
   *
   * - dependencies
   * - optionalDependencies
   * - devDependencies
   * @param {*} pkgDepItems - dep items generated by makePkgDepItems in pkg-dep-resolver.js
   *
   * @returns {*} none
   */
  setPkgDepItems(pkgDepItems, reset = false) {
    if (this._$pkg && !reset) {
      return;
    }

    const { dep, dev, opt } = pkgDepItems;
    const items = {};
    const makeDep = (acc, di) => {
      acc[di.name] = di._semver.$;
      return acc;
    };

    // check if pkg deps changed from lock
    const diffDep = (lock, update) => {
      const diff = {};
      // items that are new or changed
      for (const name in update) {
        if (!lock[name] || lock[name] !== update[name]) {
          diff[name] = update[name];
        }
      }
      // items that are removed in new deps
      for (const name in lock) {
        if (!update[name]) {
          diff[name] = "-";
        }
      }
      return diff;
    };

    const $lockPkg = this._lockData.$pkg || {};
    const $pkgDiff = {};

    if (dep) {
      items.dep = dep.reduce(makeDep, {});
    }
    $pkgDiff.dep = diffDep($lockPkg.dep || {}, items.dep || {});

    if (dev) {
      items.dev = dev.reduce(makeDep, {});
    }
    $pkgDiff.dev = diffDep($lockPkg.dev || {}, items.dev || {});

    if (opt) {
      items.opt = opt.reduce(makeDep, {});
    }
    $pkgDiff.opt = diffDep($lockPkg.opt || {}, items.opt || {});

    this._$pkg = items;
    this._$pkgDiff = $pkgDiff;

    // set diff only if existing lock data has the $pkg info
    if (this._lockData.$pkg) {
      this._$allPkgDiff = { ...$pkgDiff.dep, ...$pkgDiff.opt, ...$pkgDiff.dev };
    } else {
      this._$allPkgDiff = {};
    }

    if (!_.isEmpty(this._$allPkgDiff)) {
      logger.info("your dependencies changed for these packages:", this._$allPkgDiff);
    }
  }

  get pkgDepChanged() {
    return !_.isEmpty(this._$allPkgDiff);
  }

  /**
   * Remove the lock data for a specific dep item
   *
   * @param {*} item item to remove
   *
   * @returns {*} none
   */
  remove(item, force = false) {
    if (!this._enable) return;

    const locked = this._lockData[item.name];
    if (!locked || (!this._$allPkgDiff[item.name] && !force)) {
      return;
    }

    if (locked._) {
      // in serialized format
      Object.keys(locked._).forEach(k => {
        const lockedVers = [].concat(locked._[k]);
        if (lockedVers.includes(item.resolved)) {
          logger.debug("removing version lock info for", item.name, item.resolved, item.semver, k);
          const newLocked = lockedVers.filter(x => x !== item.resolved);
          if (newLocked.length > 0) {
            locked._[k] = newLocked;
          } else {
            delete locked._[k];
          }
        }
      });
    }

    if (locked[LOCK_RSEMVERS]) {
      // in run time format
      const lockRsv = locked[LOCK_RSEMVERS];
      for (const sv in lockRsv) {
        if (lockRsv[sv] === item.resolved) {
          delete lockRsv[sv];
        }
      }
      const sorted = locked[LOCK_SORTED_VERSIONS];
      _.remove(sorted, x => x === item.resolved);
    }
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
        if (version.startsWith("_")) return;
        const vpkg = pkg[version];
        if (vpkg.$ === "local" && Path.isAbsolute(vpkg._)) {
          if (!copied) lockData[pkgName] = pkg = Object.assign({}, pkg);
          copied = true;
          let relPath = Path.relative(from, vpkg._);
          if (!relPath.startsWith(".")) {
            relPath = `.${Path.sep}${relPath}`;
          }
          pkg[version] = Object.assign({}, vpkg, {
            _: relPath.replace(/\\/g, "/")
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
    if (!this._enable) {
      return;
    }

    if (!Path.isAbsolute(filename)) {
      filename = Path.resolve(filename);
    }

    if (!this._lockOnly) {
      assert(this._isFynFormat, "can't save lock data that's no longer in fyn format");
      const basedir = Path.dirname(filename);
      // sort by package names
      this._lockData.$fyn = this._config;
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
    if (!this._enable) {
      return false;
    }

    try {
      if (!Path.isAbsolute(filename)) filename = Path.resolve(filename);
      const data = (await Fs.readFile(filename)).toString();
      this._shaSum = this.shasum(data);
      this._lockData = Yaml.parse(data);

      const basedir = Path.dirname(filename);

      this._fullLocalPath(basedir);

      Object.assign(this._config, this._lockData.$fyn);

      logger.verbose(chalk.green(`loaded lockfile ${basedir}`));

      return true;
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

    return false;
  }

  setConfig(key, value) {
    if (value === undefined) {
      delete this._config[key];
    } else {
      this._config[key] = value;
    }
  }

  getConfig(key) {
    return this._config[key];
  }
}

module.exports = PkgDepLocker;
