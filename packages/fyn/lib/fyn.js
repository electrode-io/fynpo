"use strict";

const Fs = require("fs");
const Path = require("path");
const assert = require("assert");
const semver = require("semver");
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
const fOps = require("./util/file-ops");
const fyntil = require("./util/fyntil");

/* eslint-disable no-magic-numbers, max-statements, no-empty */

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
    return fOps.readdir(dir).each(f => fOps.$.rimraf(Path.join(dir, f)));
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

  async createPkgOutDir(dir) {
    return fOps.$
      .mkdirp(dir)
      .catch(err => {
        // exist but is not a dir? delete it and mkdir.
        return err.code === "EEXIST" && fOps.$.rimraf(dir).then(() => fOps.$.mkdirp(dir));
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

  async createDir(dir) {
    try {
      await fOps.$.mkdirp(dir);
    } catch (err) {
      // mkdirp fails with EEXIST if file exist and is not a directory
      if (err.code === "EEXIST") {
        // remove it and create as a directory
        await fOps.$.rimraf(dir);
        await fOps.$.mkdirp(dir);
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

  async moveToBackup(dir, reason) {
    // TODO: create backup dir and move
    logger.warn("Removing", dir, "due to", reason);
    return await fOps.$.rimraf(dir);
  }

  async unlinkLocalPackage(pkg, dir) {
    // TODO: look for __fyn_link_<name>.json file and
    // update accordingly
    logger.warn("Removing symlink", dir);
    return await fOps.$.rimraf(dir);
  }

  //
  // A pkg that's to be extracted must:
  //
  // - not have its target dir exist
  // - if exist then must be a dir and have a package.json
  //   with the right name and version
  //
  // If dir exist with proper package.json, then returns it,
  // else returns undefined.
  //
  async ensureProperPkgDir(pkg, dir) {
    const fullOutDir = dir || this.getInstalledPkgDir(pkg.name, pkg.version, pkg);

    let ostat;

    try {
      ostat = await fOps.lstat(fullOutDir);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      return undefined;
    }

    if (ostat.isSymbolicLink()) {
      await this.unlinkLocalPackage(pkg, fullOutDir);
    } else if (!ostat.isDirectory()) {
      await this.moveToBackup(fullOutDir, "not a directory");
    } else {
      try {
        return await this.readPkgJson(pkg, fullOutDir);
      } catch (err) {
        await this.moveToBackup(fullOutDir, "invalid existing package");
      }
    }

    return undefined;
  }

  async readPkgJson(pkg, dir) {
    const fullOutDir = dir || this.getInstalledPkgDir(pkg.name, pkg.version, pkg);
    const pkgJsonFname = Path.join(fullOutDir, "package.json");

    const buf = await fOps.readFile(pkgJsonFname);

    pkg.dir = fullOutDir;
    pkg.str = buf.toString().trim();
    const json = JSON.parse(pkg.str);

    const id = `${json.name}@${json.version}`;
    if (json.version !== pkg.version) {
      json.version = semver.valid(json.version) || semverUtil.clean(json.version);
      assert(
        semver.valid(json.version),
        `Pkg ${id} version is not valid semver and fyn was unable to fix it.`
      );
    }

    assert(
      json && json.name === pkg.name && semverUtil.equal(json.version, pkg.version),
      `Pkg in ${fullOutDir} ${id} doesn't match ${pkg.name}@${pkg.version}`
    );

    try {
      const gypFile = Path.join(fullOutDir, "binding.gyp");
      await fOps.lstat(gypFile);

      json.gypfile = true;
      const scr = json.scripts;
      if (_.isEmpty(scr) || (!scr.install && !scr.postinstall && !scr.postInstall)) {
        _.set(json, "scripts.install", "node-gyp rebuild");
      }
    } catch (err) {}

    pkg.json = json;

    return json;
  }
}

module.exports = Fyn;
