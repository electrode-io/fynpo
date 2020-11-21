"use strict";

const Path = require("path");
const assert = require("assert");
const semver = require("semver");
const _ = require("lodash");
const logger = require("./logger");
const PkgDepResolver = require("./pkg-dep-resolver");
const PkgDistFetcher = require("./pkg-dist-fetcher");
const PkgSrcManager = require("./pkg-src-manager");
const PkgDepLocker = require("./pkg-dep-locker");
const DepData = require("./dep-data");
const fynConfig = require("./fyn-config");
const semverUtil = require("./util/semver");
const Fs = require("./util/file-ops");
const fyntil = require("./util/fyntil");
const FynCentral = require("./fyn-central");
const xaa = require("./util/xaa");
const { checkPkgNeedInstall } = require("./util/check-pkg-need-install");

const { PACKAGE_RAW_INFO } = require("./symbols");
const { FYN_INSTALL_CONFIG_FILE, FV_DIR } = require("./constants");

/* eslint-disable no-magic-numbers, max-statements, no-empty, complexity */

const npmConfigEnv = require("./util/npm-config-env");

class Fyn {
  constructor(options, rcData) {
    this._rcData = Object.assign({ all: {} }, rcData);
    options = this._options = fynConfig(options);
    this._cwd = options.cwd || process.cwd();
    logger.debug(`fyn options`, JSON.stringify(fyntil.removeAuthInfo(options)));
    this.localPkgWithNestedDep = [];
    if (options.lockTime) {
      this._lockTime = new Date(options.lockTime);
      logger.info("dep lock time set to", this._lockTime.toString());
    }
    // TODO: transfer argv options
    if (options.production) this._rcData.all.production = options.production;
    this._installConfig = { time: 0 };
  }

  async readLockFiles() {
    if (this._depLocker) {
      return;
    }

    this._npmLockData = null;

    this._depLocker = new PkgDepLocker(this.lockOnly, this._options.lockfile);

    const foundLock = await this._depLocker.read(Path.join(this._cwd, "fyn-lock.yaml"));

    if (this._options.npmLock === true) {
      // force load npm lock data
    } else if (foundLock || this._options.npmLock === false) {
      return;
    }

    // https://docs.npmjs.com/files/shrinkwrap.json.html
    for (const npmLockFile of ["npm-shrinkwrap.json", "package-lock.json"]) {
      this._npmLockData = await Fs.readFile(Path.join(this._cwd, npmLockFile))
        .then(JSON.parse)
        .catch(() => null);
      if (this._npmLockData) {
        logger.info(`npm's lock data from ${npmLockFile} found, will use.`);
        break;
      }
    }
  }

  async _initCentralStore() {
    const options = this._options;
    let centralDir;

    if (this._installConfig.centralDir) {
      centralDir = this._installConfig.centralDir;
      logger.debug(`Enabling central store using dir from install config ${centralDir}`);
    } else if (process.env.FYN_CENTRAL_DIR) {
      // env wins
      centralDir = process.env.FYN_CENTRAL_DIR;
      logger.debug(`Enabling central store using dir from env FYN_CENTRAL_DIR ${centralDir}`);
    } else if (options.centralStore) {
      centralDir = Path.join(this.fynDir, "_central-storage");
      logger.debug(`Enabling central store for flag using dir ${centralDir}`);
    } else {
      return (this._central = false);
    }

    return (this._central = new FynCentral({ centralDir }));
  }

  async _initialize({ noLock = false } = {}) {
    await this._initializePkg();
    if (!noLock) {
      await this.readLockFiles();
    }
    await this._startInstall();
  }

  async _initializePkg() {
    if (!this._pkg) {
      const options = this._options;

      await this.loadPkg(options);
      this._pkgSrcMgr =
        options.pkgSrcMgr || new PkgSrcManager(Object.assign({ fyn: this }, options));
      this._data = options.data || new DepData();

      // check if there's existing installed node_modules with a fyn config file
      // to get the central store config used.
      const filename = this.getInstallConfigFile();
      try {
        const fynInstallConfig = JSON.parse(await Fs.readFile(filename));
        logger.debug("loaded fynInstallConfig", fynInstallConfig);
        this._installConfig = { ...this._installConfig, ...fynInstallConfig };
      } catch (err) {
        logger.debug("failed loaded fynInstallConfig from", filename, err);
      }

      this._runNpm = [].concat(this._options.runNpm || this._installConfig.runNpm).filter(x => x);

      // await this.readLockFiles();
    }
  }

  async _startInstall() {
    if (!this._distFetcher) {
      await this._initCentralStore();
      this._distFetcher = new PkgDistFetcher({
        pkgSrcMgr: this._pkgSrcMgr,
        fyn: this
      });
    }
  }

  async getLocalPkgInstall(localFullPath) {
    if (!this._localPkgInstall) {
      this._localPkgInstall = {};
    }

    if (!this._localPkgInstall[localFullPath]) {
      this._localPkgInstall[localFullPath] = await checkPkgNeedInstall(
        localFullPath,
        this._installConfig.time
      );
    }

    return this._localPkgInstall[localFullPath];
  }

  async checkLocalPkgFromInstallConfigNeedInstall() {
    const localsByDepth = _.get(this._installConfig, "localsByDepth", []);
    for (const locals of localsByDepth.reverse()) {
      for (const relPath of locals) {
        const fullPath = Path.join(this._cwd, relPath);
        if ((await this.getLocalPkgInstall(fullPath)).install) {
          return true;
        }
      }
    }

    return false;
  }

  setLocalDeps(localsByDepth) {
    const pathsOnly = localsByDepth.map(locals => {
      return locals.map(x => Path.relative(this._cwd, x.fullPath));
    });
    this._installConfig.localsByDepth = pathsOnly;
  }

  getInstallConfigFile() {
    return Path.join(this.getFvDir(FYN_INSTALL_CONFIG_FILE));
  }

  // save the config to outputDir
  async saveInstallConfig() {
    const outputDir = this.getOutputDir();
    const centralDir = _.get(this, "_central._centralDir", false);
    const filename = this.getInstallConfigFile();

    if (!(await Fs.exists(outputDir))) {
      return;
    }

    try {
      const outputConfig = {
        ...this._installConfig,
        time: Date.now(),
        centralDir,
        runNpm: this._runNpm
      };
      await Fs.writeFile(
        filename,
        `${JSON.stringify(outputConfig, null, 2)}
`
      );
    } catch (err) {
      logger.debug(`saving install config file failed`, err);
    }
  }

  async loadPkgFyn() {
    this._pkgFyn = await xaa.try(() =>
      fyntil.readJson(Path.resolve(this._cwd, "package-fyn.json"))
    );
    return this._pkgFyn;
  }

  async savePkgFyn(pkg) {
    pkg = !_.isEmpty(pkg) ? pkg : this._pkgFyn;
    if (!_.isEmpty(pkg)) {
      await xaa.try(() =>
        Fs.writeFile(
          Path.resolve(this._cwd, "package-fyn.json"),
          `${JSON.stringify(pkg || this._pkgFyn, null, 2)}\n`
        )
      );
    }
  }

  async loadPkg(options) {
    if (options.pkgFile) {
      const pkgFile = Path.resolve(this._cwd, options.pkgFile);
      logger.debug("package.json file", pkgFile);
      this._pkgFile = pkgFile;
      try {
        this._pkg = await fyntil.readPkgJson(pkgFile, true);
      } catch (err) {
        logger.error("failed to read package.json file", pkgFile);
        logger.error(err.message);
        fyntil.exit(err);
      }
      const pkgFyn = await this.loadPkgFyn(options);
      if (pkgFyn) {
        logger.debug("found package-fyn.json", pkgFyn);
        _.merge(this._pkg, pkgFyn);
      }
    } else {
      this._pkg = options.pkgData;
    }
  }

  savePkg() {
    Fs.writeFileSync(this._pkgFile, `${JSON.stringify(this._pkg, null, 2)}\n`);
  }

  get npmConfigEnv() {
    if (!this._npmConfigEnv) {
      this._rcData.all.cache = this._options.fynDir;
      this._npmConfigEnv = npmConfigEnv(this._pkg, this._rcData.all);
    }

    return this._npmConfigEnv;
  }

  get allrc() {
    this._rcData.all.cache = this._options.fynDir;
    return this._rcData.all;
  }

  get copy() {
    return this._options.copy || [];
  }

  get central() {
    return this._central;
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

  get registry() {
    return this._options.registry;
  }

  // offline will disable all remote retrieving
  get offline() {
    return this._options.offline && "offline";
  }

  get fynlocal() {
    return this._options.fynlocal;
  }

  // lock-only allows skip meta retrieval but still retrieve tgz
  get lockOnly() {
    return this._options.lockOnly && "lock-only";
  }

  get lockTime() {
    return this._lockTime;
  }

  get showDeprecated() {
    return this._options.showDeprecated && "show-deprecated";
  }

  get refreshOptionals() {
    return this._options.refreshOptionals;
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
    return this.lockOnly || this.offline || false;
  }

  get remoteTgzDisabled() {
    // force-cache only force use cache when it exists but if it's
    // cache miss then we should retrieve from remote
    return this.offline || false;
  }

  get pkgSrcMgr() {
    return this._pkgSrcMgr;
  }

  get fynDir() {
    return this._options.fynDir;
  }

  get targetDir() {
    return this._options.targetDir;
  }

  get alwaysFetchDist() {
    return this._options.alwaysFetchDist;
  }

  get fynTmp() {
    return Path.join(this.fynDir, "tmp");
  }

  addLocalPkgWithNestedDep(depInfo) {
    this.localPkgWithNestedDep.push(depInfo);
  }

  async resolveDependencies() {
    await this._initialize();
    this._depResolver = new PkgDepResolver(this._pkg, {
      fyn: this,
      data: this._data,
      shrinkwrap: this._npmLockData
    });
    this._depResolver.start();
    return await this._depResolver.wait();
  }

  async fetchPackages(data) {
    await this._initialize();
    this._distFetcher.start(data || this._data || this._depResolver._data);
    return await this._distFetcher.wait();
  }

  getInstalledPkgDir(name = "", version = "") {
    return Path.join(this.getOutputDir(), FV_DIR, "_", name, version);
  }

  getFvDir(x) {
    return Path.join(this._cwd, this._options.targetDir, FV_DIR, x || "");
  }

  getOutputDir(x) {
    return Path.join(this._cwd, this._options.targetDir, x || "");
  }

  getExtraDir(x) {
    return Path.join(this._cwd, this._options.targetDir, ".extra", x || "");
  }

  clearPkgOutDir(dir) {
    return Fs.readdir(dir).each(f => Fs.$.rimraf(Path.join(dir, f)));
  }

  /**
   * Scan FV_DIR for modules saved in the ${version}/${name} format
   * @returns {*} pkgs under fv dir with their versions
   */
  async loadFvVersionsVN() {
    const fvVersions = {};
    const fvDir = this.getInstalledPkgDir();
    try {
      for (const version of await Fs.readdir(fvDir)) {
        if (version === "node_modules") {
          continue; //
        }
        const verDir = Path.join(fvDir, version);

        const pkgNamesOfVersion = await Fs.readdir(verDir);

        for (let pkgName of pkgNamesOfVersion) {
          if (pkgName.startsWith("@")) {
            const scopeDir = Path.join(verDir, pkgName);
            const scope2 = await Fs.readdir(scopeDir);
            pkgName = `${pkgName}/${scope2[0]}`;
          }

          if (!fvVersions[pkgName]) {
            fvVersions[pkgName] = [];
          }

          fvVersions[pkgName].push(version);
        }
      }
    } catch (err) {}

    return fvVersions;
  }

  /**
   * Scan FV_DIR for modules saved in the ${name}/${version} format
   * @returns {*} pkgs under fv dir with their versions
   */
  async loadFvVersions() {
    const fvVersions = {};
    const fvDir = this.getInstalledPkgDir();
    try {
      for (const pkgName of await Fs.readdir(fvDir)) {
        if (pkgName === "node_modules" || pkgName.startsWith(".")) {
          continue; //
        }
        const nameDir = Path.join(fvDir, pkgName);

        const readVersionsOfPkg = async name => {
          if (!fvVersions[name]) {
            fvVersions[name] = [];
          }

          for (const version of await Fs.readdir(Path.join(fvDir, name))) {
            fvVersions[name].push(version);
          }
        };

        if (pkgName.startsWith("@")) {
          for (const name2 of await Fs.readdir(nameDir)) {
            const pkgName2 = `${pkgName}/${name2}`;
            await readVersionsOfPkg(pkgName2);
          }
        } else {
          await readVersionsOfPkg(pkgName);
        }
      }
    } catch (err) {
      logger.error("loadFvVersions failed", err);
    }

    return fvVersions;
  }

  async createPkgOutDir(dir, keep) {
    try {
      const r = await Fs.$.mkdirp(dir);
      // mkdirp returns null if directory already exist
      // clear directory to prepare it for installing package
      if (r === null && !keep && dir !== this.getOutputDir()) {
        await this.clearPkgOutDir(dir);
      }
    } catch (err) {
      // mkdirp fails with EEXIST if file exist and is not a directory
      if (err.code === "EEXIST") {
        // remove it and create as a directory
        await Fs.$.rimraf(dir);
        await Fs.$.mkdirp(dir);
      } else {
        throw err;
      }
    }
  }

  async createDir(dir) {
    try {
      await Fs.$.mkdirp(dir);
    } catch (err) {
      // mkdirp fails with EEXIST if file exist and is not a directory
      if (err.code === "EEXIST") {
        // remove it and create as a directory
        await Fs.$.rimraf(dir);
        await Fs.$.mkdirp(dir);
      } else {
        throw err;
      }
    }
  }

  // fyn's directory to store all local package linking file
  get linkDir() {
    return Path.join(this._options.fynDir, "links");
  }

  async readJson(file, fallback) {
    try {
      return JSON.parse(await Fs.readFile(file));
    } catch (e) {
      return fallback !== undefined ? fallback : {};
    }
  }

  async moveToBackup(dir, reason) {
    // TODO: create backup dir and move
    logger.warn("Removing", dir, "due to", reason);
    return await Fs.$.rimraf(dir);
  }

  async unlinkLocalPackage(pkg, dir) {
    logger.warn("Removing symlink", dir);
    return await Fs.$.rimraf(dir);
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
    const fullOutDir = dir || this.getInstalledPkgDir(pkg.name, pkg.version);

    let ostat;

    try {
      ostat = await Fs.lstat(fullOutDir);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      return null;
    }

    if (ostat.isSymbolicLink()) {
      await this.unlinkLocalPackage(pkg, fullOutDir);
    } else if (!ostat.isDirectory()) {
      await this.moveToBackup(fullOutDir, "not a directory");
    } else {
      try {
        const pkgJson = await this.loadJsonForPkg(pkg, fullOutDir);
        if (!pkgJson._invalid) {
          return pkgJson;
        }
        // no valid package.json found
        const id = pkgJson._id ? ` (id ${pkgJson._id})` : "";
        await this.moveToBackup(fullOutDir, `invalid existing package${id}`);
      } catch (err) {}
    }

    return null;
  }

  async loadJsonForPkg(pkg, dir) {
    const fullOutDir = dir || this.getInstalledPkgDir(pkg.name, pkg.version);
    const json = await fyntil.readPkgJson(fullOutDir, true);

    const pkgId = `${pkg.name}@${pkg.version}`;
    const id = `${json.name}@${json.version}`;
    if (json.version !== pkg.version) {
      const cleanVersion = semver.valid(json.version) || semverUtil.clean(json.version);

      if (cleanVersion !== json.version) {
        assert(
          semver.valid(cleanVersion),
          `Pkg ${id} version is not valid semver and fyn was unable to fix it.`
        );
        json._origVersion = json.version;
        json.version = cleanVersion;
      }
    }

    if (pkg._hasShrinkwrap) json._hasShrinkwrap = true;

    // if _id exist then it should match
    if (json._id && json._id !== pkgId) {
      logger.debug(`readPkgJson - json._id ${json._id} not matched pkg ${pkgId}`);
      json._invalid = true;
      return json;
    }

    // TODO: check npm:pkg-alias in semver
    // assert(
    //   json && json.name === pkg.name && semverUtil.equal(json.version, pkg.version),
    //   `Pkg in ${fullOutDir} ${id} doesn't match ${pkg.name}@${pkg.version}`
    // );

    pkg.dir = json[PACKAGE_RAW_INFO].dir;
    pkg.str = json[PACKAGE_RAW_INFO].str;

    try {
      const gypFile = Path.join(fullOutDir, "binding.gyp");
      await Fs.lstat(gypFile);

      json.gypfile = true;
      const scr = json.scripts;
      if (_.isEmpty(scr) || (!scr.install && !scr.postinstall && !scr.postInstall)) {
        _.set(json, "scripts.install", "node-gyp rebuild");
      }
    } catch (err) {}

    pkg.json = json;

    return json;
  }

  async createSubNodeModulesDir(dir) {
    const nmDir = Path.join(dir, "node_modules");
    // const fynIgnoreFile = Path.join(nmDir, FYN_IGNORE_FILE);

    // let ignoreExist = false;

    if (!(await Fs.exists(nmDir))) {
      await Fs.$.mkdirp(nmDir);
    } else {
      // ignoreExist = await Fs.exists(fynIgnoreFile);
    }

    // if (ignoreExist && !this.flatMeta) {
    //   await Fs.unlink(fynIgnoreFile);
    // } else if (!ignoreExist && this.flatMeta) {
    //   await Fs.writeFile(fynIgnoreFile, "");
    // }

    return nmDir;
  }
}

module.exports = Fyn;
