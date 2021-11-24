"use strict";

const Path = require("path");
const util = require("util");
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
const lockfile = require("lockfile");
const createLock = util.promisify(lockfile.lock);
const unlock = util.promisify(lockfile.unlock);
const ck = require("chalker");
const { PACKAGE_RAW_INFO, DEP_ITEM } = require("./symbols");
const { FYN_LOCK_FILE, FYN_INSTALL_CONFIG_FILE, FV_DIR, PACKAGE_FYN_JSON } = require("./constants");
const { parseYarnLock } = require("../yarn");

/* eslint-disable no-magic-numbers, max-statements, no-empty, complexity, no-eval */

const npmConfigEnv = require("./util/npm-config-env");
const PkgOptResolver = require("./pkg-opt-resolver");
const { LocalPkgBuilder } = require("./local-pkg-builder");
const { posixify } = require("./util/fyntil");

class Fyn {
  constructor({ opts = {}, _cliSource = {}, _fynpo = true }) {
    this._cliSource = _cliSource;
    const options = (this._options = fynConfig(opts));
    this._layout = options.layout;
    this._cwd = options.cwd || process.cwd();
    logger.debug(`fyn options`, JSON.stringify(fyntil.removeAuthInfo(options)));
    this.localPkgWithNestedDep = [];
    if (options.lockTime) {
      this._lockTime = new Date(options.lockTime);
      logger.info("dep lock time set to", this._lockTime.toString());
    }
    this._installConfig = { time: 0 };
    // set this env for more learning and research on ensuring
    // package dir name matches package name.
    this._noPkgDirMatchName = Boolean(process.env.FYN_NO_PKG_DIR_MATCH_NAME);
    if (!_fynpo) {
      this._fynpo = {};
    }
  }

  checkFynLockExist() {
    const fname = Path.join(this._cwd, FYN_LOCK_FILE);
    return Fs.existsSync(fname);
  }

  async readLockFiles() {
    if (this._depLocker) {
      return null;
    }

    this._npmLockData = null;

    this._depLocker = new PkgDepLocker(this.lockOnly, this._options.lockfile);

    const foundLock = await this._depLocker.read(Path.join(this._cwd, FYN_LOCK_FILE));
    const layout = this._depLocker.getConfig("layout");
    if (layout && layout !== this._layout) {
      if (this._cliSource.layout === "cli") {
        logger.info(`You are changing layout in your lockfile from ${layout} to ${this._layout}`);
        this._depLocker.setConfig("layout", this._layout);
      } else {
        logger.info(`Setting layout to ${layout} from your lockfile`);
      }
    } else {
      this._depLocker.setConfig("layout", this._layout);
    }

    if (this._options.npmLock === true) {
      // force load npm lock data
    } else if (foundLock || this._options.npmLock === false) {
      return Boolean(foundLock);
    }

    // try to read and consume npm's lockfile
    // https://docs.npmjs.com/files/shrinkwrap.json.html
    for (const npmLockFile of ["npm-shrinkwrap.json", "package-lock.json"]) {
      this._npmLockData = await Fs.readFile(Path.join(this._cwd, npmLockFile))
        .then(JSON.parse)
        .catch(() => null);
      if (this._npmLockData) {
        logger.info(`using lock data from ${npmLockFile}.`);
        return true;
      }
    }

    // try to read and consume yarn's lockfile
    const yarnLockName = Path.join(this._cwd, "yarn.lock");
    if (Fs.existsSync(yarnLockName)) {
      logger.info("Reading yarn.lock");
      const yarnLockData = await Fs.readFile(yarnLockName, "utf-8");
      this._yarnLock = parseYarnLock(yarnLockData);
    }

    return false;
  }

  get isFynpo() {
    return Boolean(this._fynpo && this._fynpo.config);
  }

  get isNormalLayout() {
    return this._layout === "normal";
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
    } else if (!this._fynpo.config) {
      return (this._central = false);
    } else {
      centralDir = this._fynpo.config.centralDir;
      if (!centralDir) {
        centralDir = Path.join(this._fynpo.dir, ".fynpo", "_store");
      }
      logger.info(`fynpo monorepo: enabling central dir ${centralDir}`);
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

  /**
   * Check user production mode option against saved install config in node_modules
   * @remarks - this._installConfig must've been initialized
   * @returns nothing
   */
  checkProductionMode() {
    if (this._installConfig.production) {
      if (this.production) {
        // user still want production mode, do nothing
      } else if (this._cliSource.production === "default") {
        // user didn't specify any thing about production mode, assume no change
        logger.info(
          ck`<orange>Setting production mode</> because existing node_modules is production mode.
  To force no production mode, pass --no-production flag.`
        );
        this._options.production = true;
      } else {
        logger.info(`Changing existing node_modules to NO production mode`);
        this._changeProdMode = this._cliSource.production;
      }
    } else if (this.production) {
      if (!this._installConfig.production) {
        logger.info(`Changing existing node_modules to production mode`);
        this._changeProdMode = this._cliSource.production;
      }
    }
  }

  checkNoFynLocal(name) {
    const noFynLocal = ["dependencies", "devDependencies", "optionalDependencies"].find(sec => {
      const semv = _.get(this._pkg, ["fyn", sec, name]);
      return semv === false || (semv && semv.includes("no-fyn-local"));
    });

    return Boolean(noFynLocal);
  }

  async _initializePkg() {
    if (!this._fynpo) {
      this._fynpo = await fyntil.loadFynpo(this._cwd);
      // TODO: options from CLI should not be override by fynpo config options
      _.merge(this._options, _.get(this, "_fynpo.fyn.options"));
      this._layout = this._options.layout;
    }

    if (!this._pkg) {
      const options = this._options;

      await this.loadPkg(options);
      this._pkgSrcMgr =
        options.pkgSrcMgr || new PkgSrcManager(Object.assign({ fyn: this }, options));
      // this._data = options.data || new DepData();

      // check if there's existing installed node_modules with a fyn config file
      // to get the central store config used.
      const filename = this.getInstallConfigFile();
      try {
        const fynInstallConfig = JSON.parse(await Fs.readFile(filename));
        logger.debug("loaded fynInstallConfig", fynInstallConfig);
        const { layout } = fynInstallConfig;
        if (layout && layout !== this._layout) {
          if (this._cliSource.layout !== "default") {
            logger.warn(
              `Forcing layout to ${layout} from ${this._layout} because your existing node_modules uses that. To change it, please remove node_modules first.`
            );
          }
          this._layout = layout;
        }
        this._installConfig = { ...this._installConfig, ...fynInstallConfig, layout };
      } catch (err) {
        logger.debug("failed loaded fynInstallConfig from", filename, err);
      }

      this.checkProductionMode();

      let fynpoNpmRun;

      if (this._fynpo.config) {
        if (this._fynpo.graph.getPackageAtDir(this._cwd)) {
          // the command.bootstrap.npmRunScripts can be
          // - a string
          // - an array of strings
          // - an array of strings and/or array of strings - each sub array indicates a list of
          //   script names and fyn will run only the first one that exist
          fynpoNpmRun = _.get(this, "_fynpo.config.command.bootstrap.npmRunScripts", undefined);
          if (_.isArray(fynpoNpmRun) && !_.isEmpty(fynpoNpmRun)) {
            logger.info("fynpo monorepo: npm run scripts", fynpoNpmRun);
          } else if (fynpoNpmRun !== false) {
            fynpoNpmRun = ["build"];
            logger.info("fynpo monorepo: default to auto run npm scripts:", fynpoNpmRun);
          }
        } else if (this._cwd !== this._fynpo.dir) {
          logger.info(
            "package at",
            this._cwd,
            "is not part of fynpo's packages. fynpo top dir is",
            this._fynpo.dir
          );
        }
      }

      this._runNpm = _.uniq([].concat(this._options.runNpm, fynpoNpmRun).filter(x => x));
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

  async saveFynpoIndirects() {
    if (!this.isFynpo || this._fynpo.dir === this.cwd || _.isEmpty(this._fynpo.indirects)) {
      return;
    }

    const lockFile = Path.join(this._fynpo.dir, ".fynpo/fynpo-data.lock");
    const { indirects } = this._fynpo;

    try {
      const dataFile = Path.join(this._fynpo.dir, ".fynpo-data.json");
      await Fs.$.mkdirp(Path.join(this._fynpo.dir, ".fynpo"));
      await Fs.$.acquireLock(lockFile, {
        wait: 5000,
        pollPeriod: 100,
        stale: 8000,
        retries: 10,
        retryWait: 500
      });
      const path = posixify(Path.relative(this._fynpo.dir, this.cwd));
      const fynpoData = await fyntil.readJson(dataFile, { indirects: { [path]: [] } });
      if (JSON.stringify(indirects) !== JSON.stringify(fynpoData.indirects[path])) {
        logger.info(
          `saving indirect dep to .fynpo-data.json. fyn recommends that you commit the file.`
        );
        fynpoData.indirects[path] = indirects;
        fynpoData.__timestamp = Date.now();
        await Fs.writeFile(dataFile, `${JSON.stringify(fynpoData, null, 2)}\n`);
      }
    } finally {
      await Fs.$.releaseLock(lockFile);
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
        if ((await this.getLocalPkgInstall(fullPath)).changed) {
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
        // add 5ms to ensure it's newer than fyn-lock.yaml, which was just saved
        // immediately before this
        time: Date.now() + 5,
        centralDir,
        production: this.production,
        layout: this._layout
        // not a good idea to save --run-npm options to install config because
        // future fyn install will automatically run them and would be unexpected.
        // if fynpo bootstrap should run certain npm scripts, user should set those
        // in fynpo config.  and fyn should look into those when detected a fynpo.
        // runNpm: this._runNpm
      };
      await Fs.writeFile(filename, `${JSON.stringify(outputConfig, null, 2)}\n`);
    } catch (err) {
      logger.debug(`saving install config file failed`, err);
    }
  }

  async loadPkgFyn() {
    this._pkgFyn = await xaa.try(() => fyntil.readJson(Path.resolve(this._cwd, PACKAGE_FYN_JSON)));
    return this._pkgFyn;
  }

  async savePkgFyn(pkg) {
    pkg = !_.isEmpty(pkg) ? pkg : this._pkgFyn;
    if (!_.isEmpty(pkg)) {
      await xaa.try(() =>
        Fs.writeFile(
          Path.resolve(this._cwd, PACKAGE_FYN_JSON),
          `${JSON.stringify(pkg || this._pkgFyn, null, 2)}\n`
        )
      );
    }
  }

  async loadPkg(_options) {
    const options = _options || this._options;

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
        logger.debug(`found ${PACKAGE_FYN_JSON}`, pkgFyn);
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
      const options = { ...this._options, cache: this._options.fynDir };
      this._npmConfigEnv = npmConfigEnv(this._pkg, options);
    }

    return this._npmConfigEnv;
  }

  get allrc() {
    return this._options;
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

  deDupeLocks() {
    let deDupe = false;

    _.each(this._data.pkgs, (pkg, pkgName) => {
      const versions = Object.keys(pkg);
      const byMaj = _.groupBy(versions, x => {
        const pts = x.split(".");
        // when major is 0, minor becomes major, ie: 0.x.y => x major
        if (pts[0] === "0") {
          if (pts[1] === "0") {
            return `${pts[0]}.${pts[1]}.${pts[2]}`;
          }
          return `${pts[0]}.${pts[1]}`;
        } else {
          return pts[0];
        }
      });
      const majVersions = Object.keys(byMaj);

      // if all major versions different, then no need to de-dupe anything
      if (majVersions.length === versions.length) {
        return;
      }

      majVersions.forEach(maj => {
        if (byMaj[maj].length > 1) {
          const removed = byMaj[maj].filter(ver => {
            const item = pkg[ver][DEP_ITEM];
            if (item._resolveByLock || this._npmLockData) {
              deDupe = true;
              this._depLocker.remove(item, true);
              return true;
            }
            return false;
          });
          if (removed.length > 0) {
            logger.debug("de-dupe locks by removing versions of", pkgName, removed);
          }
          // TODO: by removing all versions, it will update to the latest, which may be newer
          // than the newest version in lock data, so we should keep newest locked and update
          // all removed ones to it
        }
      });
    });

    return deDupe;
  }

  createLocalPkgBuilder(localsByDepth) {
    if (!this._localPkgBuilder) {
      this._localPkgBuilder = new LocalPkgBuilder({
        fyn: this,
        localsByDepth
      });
      this.setLocalDeps(localsByDepth);
    }

    return this._localPkgBuilder;
  }

  async resolveDependencies() {
    await this._initialize();

    this._optResolver = new PkgOptResolver({ fyn: this });

    const doResolve = async ({ shrinkwrap, yarnLock, buildLocal = true, deDuping = false }) => {
      this._data = this._options.data || new DepData();
      this._depResolver = new PkgDepResolver(this._pkg, {
        fyn: this,
        data: this._data,
        shrinkwrap,
        yarnLock,
        optResolver: this._optResolver,
        buildLocal,
        deDuping
      });
      this._depResolver.start();
      await this._depResolver.wait();
    };

    await doResolve({
      shrinkwrap: this._npmLockData,
      yarnLock: this._yarnLock,
      buildLocal: this._options.buildLocal
    });

    if (this._npmLockData) {
      this.depLocker.generate(this._data);
    }

    if (
      (this._yarnLock || this._npmLockData || this.depLocker.pkgDepChanged) &&
      this.deDupeLocks()
    ) {
      logger.info("changed dependencies and duplicate versions detected => de-duping");
      await doResolve({ buildLocal: false, deDuping: true });
    }
  }

  async fetchPackages(data) {
    await this._initialize();
    this._distFetcher.start(data || this._data || this._depResolver._data);
    return await this._distFetcher.wait();
  }

  /**
   * Create a lock in FV dir during install, to prevent multiple install
   * being run at the same time.
   *
   * This would just cause second installs to fail instead of causing random
   * weird issues.
   *
   * - Rare but could occur if fyn is used for monorepo and user has script
   *   that run concurrent installs
   *
   * @returns {boolean} if lock was acquired
   */
  async createInstallLock() {
    await this.createDir(this.getFvDir());
    const fname = this.getFvDir(".installing.lock");
    await createLock(fname, {
      wait: 3000,
      // consider 30 minutes lockfile stale
      stale: 30 * 60 * 1000
    });
    return true;
  }

  /**
   * Remove lock during install
   *
   * @returns {*} none
   */
  async removeInstallLock() {
    const fname = this.getFvDir(".installing.lock");
    return await unlock(fname);
  }

  /**
   * Get the directory where a package should be installed/extracted into
   *
   * @param {*} name - name of the package
   * @param {*} version - version of the package
   * @param {*} pkg - pkg data
   *
   * @returns {string} dir for package
   */
  getInstalledPkgDir(name = "", version = "", pkg) {
    // in normal layout, promoted package should go to top node_modules dir directly
    if (this.isNormalLayout && pkg && pkg.promoted) {
      return Path.join(this.getOutputDir(), name);
    }

    // it's important that each package is directly extracted to a directory
    // that has name exactly the same as the package because there are code
    // and tools that depend on that.
    // for example: webpack module de-duping seems to depend on that, otherwise
    // the bundle bloats.
    if (version) {
      if (this._noPkgDirMatchName) {
        return Path.join(this.getOutputDir(), FV_DIR, "_", name, version);
      } else {
        return Path.join(this.getOutputDir(), FV_DIR, "_", name, version, name);
      }
    }

    return Path.join(this.getOutputDir(), FV_DIR, "_", name);
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
   * Scan FV_DIR for modules saved in the ${name}/${version} format
   * @returns {*} pkgs under fv dir with their versions
   */
  async loadFvVersions() {
    const fvVersions = {};
    // get dir where all packages are extracted to
    const pkgStoreDir = this.getFvDir("_");
    try {
      for (const pkgName of await Fs.readdir(pkgStoreDir)) {
        if (pkgName === "node_modules" || pkgName.startsWith(".")) {
          continue; //
        }

        const readVersionsOfPkg = async name => {
          if (!fvVersions[name]) {
            fvVersions[name] = [];
          }

          for (const version of await Fs.readdir(Path.join(pkgStoreDir, name))) {
            fvVersions[name].push(version);
          }
        };

        if (pkgName.startsWith("@")) {
          // handle scoped package names
          for (const name2 of await Fs.readdir(Path.join(pkgStoreDir, pkgName))) {
            const pkgName2 = `${pkgName}/${name2}`;
            await readVersionsOfPkg(pkgName2);
          }
        } else {
          await readVersionsOfPkg(pkgName);
        }
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        logger.error("loadFvVersions failed", err);
      }
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

  async moveToFv(dir, pkg, pkgJson) {
    const toDir = this.getInstalledPkgDir(pkgJson.name, pkgJson.version, {});

    try {
      await Fs.access(toDir);
      // a copy already exist in FV dir, so remove it
      logger.warn(
        `Removing ${dir} because its version ${pkgJson.version} is different from ${pkg.version}`
      );
      await Fs.$.rimraf(dir);
    } catch (err) {
      logger.debug(`Moving ${dir} to ${toDir} to replace with version ${pkg.version}`);
      await Fs.$.mkdirp(Path.dirname(toDir));
      await Fs.rename(dir, toDir);
    }
  }

  async unlinkLocalPackage(dir, reason) {
    logger.warn(`Removing ${dir} because it's ${reason}`);
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
    const fullOutDir = dir || this.getInstalledPkgDir(pkg.name, pkg.version, pkg);

    let ostat;

    try {
      ostat = await Fs.lstat(fullOutDir);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      return null;
    }

    if (ostat.isSymbolicLink()) {
      await this.unlinkLocalPackage(fullOutDir, "a symlink");
    } else if (!ostat.isDirectory()) {
      await this.unlinkLocalPackage(fullOutDir, "not a directory");
    } else {
      try {
        const pkgJson = await this.loadJsonForPkg(pkg, fullOutDir);
        if (!pkgJson._invalid) {
          return pkgJson;
        }
        await this.moveToFv(fullOutDir, pkg, pkgJson);
      } catch (err) {
        logger.warn(`ensureProperPkgdir:`, err);
      }
    }

    return null;
  }

  async loadJsonForPkg(pkg, dir) {
    const fullOutDir = dir || this.getInstalledPkgDir(pkg.name, pkg.version, pkg);
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
