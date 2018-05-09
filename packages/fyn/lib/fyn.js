"use strict";

const Fs = require("fs");
const Path = require("path");
const assert = require("assert");
const semver = require("semver");
const Promise = require("bluebird");
const mkdirp = require("mkdirp");
const rimraf = require("rimraf");
const _ = require("lodash");
const logger = require("./logger");
const PkgDepResolver = require("./pkg-dep-resolver");
const PkgDistFetcher = require("./pkg-dist-fetcher");
const PkgSrcManager = require("./pkg-src-manager");
const PkgDepLocker = require("./pkg-dep-locker");
const DepData = require("./dep-data");
const fynConfig = require("./fyn-config");
const semverUtil = require("./util/semver");
const readFile = Promise.promisify(Fs.readFile);
const readdir = Promise.promisify(Fs.readdir);
const mkdirpAsync = Promise.promisify(mkdirp);
const rimrafAsync = Promise.promisify(rimraf);
const fyntil = require("./util/fyntil");

/* eslint-disable no-magic-numbers */

class Fyn {
  constructor(options) {
    options = this._options = fynConfig(options);
    this._cwd = options.cwd || process.cwd();

    this.loadPkg(options);

    logger.debug(`fyn options`, JSON.stringify(options));

    this._pkgSrcMgr = options.pkgSrcMgr || new PkgSrcManager(Object.assign({ fyn: this }, options));
    this._data = options.data || new DepData();
    this._depLocker = new PkgDepLocker(this.lockOnly, options.lockfile);
    this._depLocker.read(Path.join(this._cwd, "fyn-lock.yaml"));
    this.localPkgWithNestedDep = [];
  }

  loadPkg(options) {
    if (options.pkgFile) {
      const pkgFile = Path.resolve(this._cwd, options.pkgFile);
      logger.debug("package JSON file", pkgFile);
      this._pkgFile = pkgFile;
      try {
        this._pkg = JSON.parse(Fs.readFileSync(pkgFile).toString());
      } catch (err) {
        logger.error("failed to read package.json file", pkgFile);
        logger.error(err.message);
        fyntil.exit(err);
      }
    } else {
      this._pkg = options.pkgData;
    }
  }

  savePkg() {
    Fs.writeFileSync(this._pkgFile, `${JSON.stringify(this._pkg, null, 2)}\n`);
  }

  get depLocker() {
    return this._depLocker;
  }

  get cwd() {
    return this._cwd;
  }

  get forceCache() {
    return this._options.forceCache && "force-cache";
  }

  // local-only will disable all remote retrieving
  get localOnly() {
    return this._options.localOnly && "local-only";
  }

  // lock-only allows skip meta retrieval but still retrieve tgz
  get lockOnly() {
    return this._options.lockOnly && "lock-only";
  }

  get showDeprecated() {
    return this._options.showDeprecated && "show-deprecated";
  }

  get ignoreDist() {
    return this._options.ignoreDist;
  }

  get production() {
    return this._options.production;
  }

  get concurrency() {
    return this._options.concurrency;
  }

  get deepResolve() {
    return this._options.deepResolve;
  }

  get preferLock() {
    return this._options.preferLock;
  }

  get remoteMetaDisabled() {
    // force-cache only force use cache when it exists but if it's
    // cache miss then we should retrieve from remote
    return this.lockOnly || this.localOnly || false;
  }

  get remoteTgzDisabled() {
    // force-cache only force use cache when it exists but if it's
    // cache miss then we should retrieve from remote
    return this.localOnly || false;
  }

  get pkgSrcMgr() {
    return this._pkgSrcMgr;
  }

  get needFlatModule() {
    return this._needFlatModule;
  }

  set needFlatModule(x) {
    this._needFlatModule = x;
  }

  addLocalPkgWithNestedDep(depInfo) {
    this.localPkgWithNestedDep.push(depInfo);
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
    return this._distFetcher.wait();
  }

  getInstalledPkgDir(name, version, pkg) {
    return pkg.promoted
      ? Path.join(this.getOutputDir(), name)
      : Path.join(this.getOutputDir(), `__fv_`, version, name);
  }

  getFvDir(x) {
    return Path.join(this._cwd, this._options.targetDir, "__fv_", x || "");
  }

  getOutputDir(x) {
    return Path.join(this._cwd, this._options.targetDir, x || "");
  }

  getExtraDir(x) {
    return Path.join(this._cwd, this._options.targetDir, ".extra", x || "");
  }

  clearPkgOutDir(dir) {
    return readdir(dir).each(f => rimrafAsync(Path.join(dir, f)));
  }

  loadFvVersions() {
    const fvVersions = {};
    const fvDir = this.getOutputDir("__fv_");

    const versions = (Fs.existsSync(fvDir) && Fs.readdirSync(fvDir)) || [];
    for (const v of versions) {
      const verDir = Path.join(fvDir, v);
      const mods = Fs.readdirSync(verDir);
      for (let m of mods) {
        if (m.startsWith("@")) {
          const scopeDir = Path.join(verDir, m);
          const scope2 = Fs.readdirSync(scopeDir);
          m = Path.join(m, scope2[0]);
        }
        if (!fvVersions[m]) {
          fvVersions[m] = [];
        }
        fvVersions[m].push(v);
      }
    }

    return fvVersions;
  }

  createPkgOutDir(dir) {
    return mkdirpAsync(dir)
      .catch(err => {
        // exist but is not a dir? delete it and mkdir.
        return err.code === "EEXIST" && rimrafAsync(dir).then(() => mkdirpAsync(dir));
      })
      .then(r => {
        // dir already exist? clear it.
        return r === null && this.clearPkgOutDir(dir);
      });
  }

  clearPkgOutDirSync(dir) {
    Fs.readdirSync(dir).forEach(f => rimraf.sync(Path.join(dir, f)));
  }

  createPkgOutDirSync(dir, keep) {
    try {
      const r = mkdirp.sync(dir);
      // mkdirp returns null if directory already exist
      // clear directory to prepare it for installing package
      if (r === null && !keep && dir !== this.getOutputDir()) {
        this.clearPkgOutDirSync(dir);
      }
    } catch (err) {
      // mkdirp fails with EEXIST if file exist and is not a directory
      if (err.code === "EEXIST") {
        // remove it and create as a directory
        rimraf.sync(dir);
        mkdirp.sync(dir);
      } else {
        throw err;
      }
    }
  }

  createDirSync(dir) {
    try {
      mkdirp.sync(dir);
    } catch (err) {
      // mkdirp fails with EEXIST if file exist and is not a directory
      if (err.code === "EEXIST") {
        // remove it and create as a directory
        rimraf.sync(dir);
        mkdirp.sync(dir);
      } else {
        throw err;
      }
    }
  }

  // fyn's directory to store all local package linking file
  get linkDir() {
    return Path.join(this._options.fynDir, "links");
  }

  readJson(file, fallback) {
    try {
      return JSON.parse(Fs.readFileSync(file));
    } catch (e) {
      return fallback !== undefined ? fallback : {};
    }
  }

  readPkgJson(pkg) {
    const fullOutDir = this.getInstalledPkgDir(pkg.name, pkg.version, pkg);
    const pkgJsonFname = Path.join(fullOutDir, "package.json");
    const gypFile = Path.join(fullOutDir, "binding.gyp");
    const gypExist = Fs.existsSync(gypFile);
    return readFile(pkgJsonFname)
      .then(buf => {
        pkg.dir = fullOutDir;
        pkg.str = buf.toString();
        return JSON.parse(pkg.str);
      })
      .tap(x => {
        const id = `${x.name}@${x.version}`;
        if (x.version !== pkg.version) {
          x.version = semver.valid(x.version) || semverUtil.clean(x.version);
          assert(
            semver.valid(x.version),
            `Pkg ${id} version is not valid semver and fyn was unable to fix it.`
          );
        }

        assert(
          x && x.name === pkg.name && semverUtil.equal(x.version, pkg.version),
          `Pkg in ${fullOutDir} ${id} doesn't match ${pkg.name}@${pkg.version}`
        );

        if (gypExist) {
          x.gypfile = true;
          const scr = x.scripts;
          if (_.isEmpty(scr) || (!scr.install && !scr.postinstall && !scr.postInstall)) {
            _.set(x, "scripts.install", "node-gyp rebuild");
          }
        }

        pkg.json = x;
      });
  }
}

module.exports = Fyn;
