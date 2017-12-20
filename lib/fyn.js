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
const fixSemver = require("./util/fix-semver");
const readFile = Promise.promisify(Fs.readFile);
const readdir = Promise.promisify(Fs.readdir);
const mkdirpAsync = Promise.promisify(mkdirp);
const rimrafAsync = Promise.promisify(rimraf);

class Fyn {
  constructor(options) {
    options = this._options = fynConfig(options);
    this._cwd = options.cwd || process.cwd();

    this._pkgSrcMgr = options.pkgSrcMgr || new PkgSrcManager(Object.assign({ fyn: this }, options));
    if (options.pkgFile) {
      const pkgFile = Path.resolve(this._cwd, options.pkgFile);
      logger.debug("package JSON file", pkgFile);
      this._pkgFile = pkgFile;
      try {
        this._pkg = JSON.parse(Fs.readFileSync(pkgFile).toString());
      } catch (err) {
        logger.error("failed to read package.json file", pkgFile);
        logger.error(err.message);
        process.exit(1);
      }
    } else {
      this._pkg = options.pkgData;
    }
    this._data = options.data || new DepData();
    this._depLocker = new PkgDepLocker(this.lockOnly, options.lockfile);
    this._depLocker.read(Path.join(this._cwd, "fyn-lock.yaml"));
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
    return Path.join(this.getOutputDir(), name, pkg.promoted ? "" : `__fv_/${version}/${name}`);
  }

  getOutputDir() {
    return Path.join(this._cwd, this._options.targetDir);
  }

  clearPkgOutDir(dir) {
    return readdir(dir)
      .then(files => files.filter(x => x !== "__fv_"))
      .each(f => rimrafAsync(Path.join(dir, f)));
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
    Fs.readdirSync(dir)
      .filter(x => x !== "__fv_")
      .forEach(f => rimraf.sync(Path.join(dir, f)));
  }

  createPkgOutDirSync(dir) {
    try {
      const r = mkdirp.sync(dir);
      if (r === null) this.clearPkgOutDirSync(dir);
    } catch (err) {
      if (err.code === "EEXIST") {
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
      if (err.code === "EEXIST") {
        rimraf.sync(dir);
        mkdirp.sync(dir);
      } else {
        throw err;
      }
    }
  }

  get linkDir() {
    return Path.join(this._options.fynDir, "links");
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
          x.version = semver.valid(x.version) || fixSemver(x.version);
          assert(
            semver.valid(x.version),
            `Pkg ${id} version is not valid semver and fyn was unable to fix it.`
          );
        }

        assert(
          x && x.name === pkg.name && x.version === pkg.version,
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
