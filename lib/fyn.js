"use strict";

const Fs = require("fs");
const Path = require("path");
const assert = require("assert");
const semver = require("semver");
const Promise = require("bluebird");
const mkdirp = require("mkdirp");
const rimraf = require("rimraf");
const PkgDepResolver = require("./pkg-dep-resolver");
const PkgDistFetcher = require("./pkg-dist-fetcher");
const PkgSrcManager = require("./pkg-src-manager");
const PkgDepLocker = require("./pkg-dep-locker");
const DepData = require("./dep-data");
const fynConfig = require("./fyn-config");
const logger = require("./logger");
const fixSemver = require("./util/fix-semver");
const readFile = Promise.promisify(Fs.readFile);
const readdir = Promise.promisify(Fs.readdir);
const mkdirpAsync = Promise.promisify(mkdirp);
const rimrafAsync = Promise.promisify(rimraf);

class Fyn {
  constructor(options) {
    options = this._options = fynConfig(options);
    this._pkgSrcMgr = options.pkgSrcMgr || new PkgSrcManager(Object.assign({ fyn: this }, options));
    if (options.pkgFile) {
      const pkgFile = Path.resolve(options.pkgFile);
      this._pkgFile = pkgFile;
      this._pkg = JSON.parse(Fs.readFileSync(pkgFile).toString());
    } else {
      this._pkg = options.pkgData;
    }
    this._data = options.data || new DepData();
    this._cwd = options.cwd || process.cwd();
    this._depLocker = new PkgDepLocker(this._regenOnly);
    this._depLocker.read(Path.join(this._cwd, "fyn-lock.yaml"));
  }

  get regenOnly() {
    return this._options.regenOnly;
  }

  get depLocker() {
    return this._depLocker;
  }

  get cwd() {
    return this._cwd;
  }

  get localOnly() {
    return this._options.localOnly;
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
      const r = mkdirp.sync(dir);
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
    return readFile(pkgJsonFname)
      .then(buf => {
        pkg.dir = fullOutDir;
        pkg.str = buf.toString();
        return JSON.parse(pkg.str);
      })
      .tap(x => {
        const id = `${x.name}@${x.version}`;
        if (x.version !== pkg.version) {
          if (!semver.valid(x.version)) {
            x.version = fixSemver(x.version);
            assert(
              semver.valid(x.version),
              `Pkg ${id} version is not valid semver and fyn was unable to fix it.`
            );
          }
        }

        assert(
          x && x.name === pkg.name && x.version === pkg.version,
          `Pkg in ${fullOutDir} ${id} doesn't match ${pkg.name}@${pkg.version}`
        );
        pkg.json = x;
      });
  }
}

module.exports = Fyn;
