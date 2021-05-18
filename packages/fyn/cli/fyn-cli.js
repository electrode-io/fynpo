"use strict";

// const Module = require("module");
const Fs = require("../lib/util/file-ops");
const Os = require("os");
const Path = require("path");
const Promise = require("bluebird");
const Fyn = require("../lib/fyn");
const _ = require("lodash");
const PkgInstaller = require("../lib/pkg-installer");
// const DepData = require("../lib/dep-data");
const semver = require("semver");
const chalk = require("chalk");
const logger = require("../lib/logger");
const PromiseQueue = require("../lib/util/promise-queue");
const sortObjKeys = require("../lib/util/sort-obj-keys");
const fyntil = require("../lib/util/fyntil");
const showStat = require("./show-stat");
// const showSetupInfo = require("./show-setup-info");
// const logFormat = require("../lib/util/log-format");
const runNpmScript = require("../lib/util/run-npm-script");
const npmLifecycle = require("npm-lifecycle");
const npmlog = require("npmlog");
const xaa = require("../lib/util/xaa");
const { scanFileStats } = require("../lib/util/stat-dir");
const { checkPkgNewVersionEngine } = require("check-pkg-new-version-engine");
const fetch = require("node-fetch-npm");
const myPkg = require("./mypkg");

function checkNewVersion(npmConfig) {
  checkPkgNewVersionEngine({
    pkg: _.pick(myPkg, ["name", "version"]),
    npmConfig,
    checkIsNewer: (pkg, distTags, tag) => {
      const isNewer = semver.gt(distTags[tag], pkg.version);
      return { isNewer, version: distTags[tag] };
    },
    fetchJSON: async (url, options) => {
      const res = await fetch(url, options);
      return await res.json();
    }
  });
}

const {
  FETCH_META,
  FETCH_PACKAGE,
  LOAD_PACKAGE,
  INSTALL_PACKAGE,
  spinner
} = require("../lib/log-items");

const myDir = Path.join(__dirname, "..");

class FynCli {
  constructor(config) {
    this._config = config;
    this._opts = config.opts;
    if (config.noStartupInfo !== true) this.showStartupInfo();
    this._fyn = undefined;
  }

  get fyn() {
    if (!this._fyn) {
      this._fyn = new Fyn(this._config);
    }
    return this._fyn;
  }

  showStartupInfo() {
    logger.verbose(chalk.green("fyn"), "version", myPkg.version, "at", chalk.magenta(myDir));
    logger.verbose(
      chalk.green("NodeJS"),
      "version",
      process.version,
      "at",
      chalk.magenta(process.execPath)
    );
    logger.verbose("env NODE_OPTIONS is", chalk.magenta(process.env.NODE_OPTIONS));
    logger.verbose("working dir is", chalk.magenta(this._opts.cwd));
    logger.verbose("Max network concurrency is", this._opts.concurrency);
  }

  async saveLogs(dbgLog) {
    return Fs.writeFile(Path.resolve(this._opts.cwd, dbgLog), logger.logData.join("\n") + "\n");
  }

  async fail(msg, err) {
    const dbgLog =
      this._opts.saveLogs || Path.join(Os.tmpdir(), `fyn-debug-${process.pid}-${Date.now()}.log`);
    logger.freezeItems(true);
    logger.error(msg, `CWD ${this.fyn.cwd}`);
    logger.error("process.argv", process.argv);
    logger.error(msg, "Please check for any errors that occur above.");
    const lessCmd = chalk.magenta(`less -R ${dbgLog}`);
    logger.error(
      msg,
      `Also check ${chalk.magenta(dbgLog)} for more details. ${lessCmd} if you are on Un*x.`
    );
    logger.error(msg, err.message);
    logger.debug("STACK:", err.stack);
    await this.saveLogs(dbgLog);
    fyntil.exit(err);
  }

  add(argv) {
    return this.fyn._initialize().then(() => this._add(argv));
  }

  async _add(argv) {
    const addSec = async (section, packages) => {
      if (_.isEmpty(packages)) return [];

      const items = await xaa.map(packages, async pkgSemver => {
        const xfp = Path.resolve(pkgSemver);
        const stat = await xaa.try(() => Fs.stat(xfp));
        if (stat && stat.isDirectory()) {
          pkgSemver = Path.relative(process.cwd(), xfp);
          if (!pkgSemver.startsWith(`..${Path.sep}`)) {
            pkgSemver = `.${Path.sep}${pkgSemver}`;
          }
        }

        const posixPath = pkgSemver.replace(/\\/g, "/");
        const semverPath = this.fyn.pkgSrcMgr.getSemverAsFilepath(posixPath);

        logger.info("found semverPath", semverPath);
        if (semverPath) {
          return {
            $: posixPath,
            name: "",
            semver: posixPath,
            semverPath,
            localType: "hard",
            section,
            parent: {}
          };
        }
        const atX = posixPath.lastIndexOf("@");
        return {
          $: posixPath,
          name: atX > 0 ? posixPath.substr(0, atX) : posixPath,
          semver: atX > 0 ? posixPath.substr(atX + 1) : "latest",
          section,
          parent: {}
        };
      });

      if (!_.isEmpty(items)) {
        logger.info(`Adding packages to ${section}:`, packages.join(", "));
      }

      return items;
    };

    const sections = {
      dependencies: "packages",
      devDependencies: "dev",
      optionalDependencies: "optional",
      peerDependencies: "peer"
    };

    let items = [];
    for (const section in sections) {
      const argKey = sections[section];
      items = items.concat(await addSec(section, argv[argKey]));
    }

    if (_.isEmpty(items)) {
      logger.error("No packages to add");
      fyntil.exit(1);
    }

    logger.addItem({ name: FETCH_META, color: "green", spinner });
    logger.updateItem(FETCH_META, "loading meta...");

    const results = [];

    return new PromiseQueue({
      concurrency: 10,
      stopOnError: true,
      processItem: item => {
        let found;
        return Promise.try(() => this._fyn._pkgSrcMgr.fetchLocalItem(item))
          .then(meta => meta || this.fyn.pkgSrcMgr.fetchMeta(item))
          .then(meta => {
            if (!meta) {
              logger.error("Unable to retrieve meta for package", item.name);
              return;
            }
            // logger.info("adding", x.name, x.semver, meta);
            // look at dist tags
            const tags = meta["dist-tags"];
            if (meta.local) {
              logger.info("adding local package at", item.fullPath);
              item.name = meta.name;
              item.version = _.get(meta, "json.version");
              found = Path.relative(this.fyn.cwd, item.fullPath).replace(/\\/g, "/");
              if (found !== item.fullPath && !found.startsWith(".")) {
                found = `./${found}`;
              }
            } else if (tags && tags[item.semver]) {
              logger.debug("adding with dist tag for", item.name, item.semver, tags[item.semver]);
              found = `^${tags[item.semver]}`;
              if (!semver.validRange(found)) found = tags[item.semver];
            } else {
              // search
              const versions = Object.keys(meta.versions).filter(v =>
                semver.satisfies(v, item.semver)
              );
              if (versions.length > 0) {
                found = item.semver;
              } else {
                logger.error(chalk.red(`no matching version found for ${item.$}`));
              }
            }
            if (found) {
              logger.info(`found ${found} for ${item.$}`);
              item.found = found;
              results.push(item);
            }
          });
      },
      watchTime: 5000
    })
      .addItems(items)
      .resume()
      .wait()
      .then(async () => {
        logger.removeItem(FETCH_META);

        if (results.length === 0) {
          logger.info("No packages found for add");
          return false;
        }

        const added = _.mapValues(sections, () => []);

        const pkg = this.fyn._pkg;
        const pkgFyn = argv.pkgFyn ? (await this.fyn.loadPkgFyn()) || {} : pkg;

        results.forEach(item => {
          if (item.semverPath) {
            // set in package-fyn
            if (!this._fyn.isFynpo || !this._fyn._fynpo.packagesByName[item.name]) {
              _.set(pkgFyn, ["fyn", item.section, item.name], item.found);
            }
            // set in package if it's not there
            if (!_.get(pkg, [item.section, item.name])) {
              _.set(pkg, [item.section, item.name], item.version ? `^${item.version}` : item.found);
            }
          } else {
            _.set(pkg, [item.section, item.name], item.found);
          }
          added[item.section].push(item.name);
        });

        Object.keys(sections).forEach(sec => {
          if (added[sec].length > 0 && pkg[sec]) {
            pkg[sec] = sortObjKeys(pkg[sec]);
            if (_.get(pkgFyn, ["fyn", sec])) {
              pkgFyn.fyn[sec] = sortObjKeys(pkgFyn.fyn[sec]);
            }
            logger.info(`Packages added to ${sec}:`, added[sec].join(", "));
          }
        });

        await this.fyn.savePkg();
        if (argv.pkgFyn) {
          await this.fyn.savePkgFyn(pkgFyn);
        }
        return true;
      });
  }

  async remove(argv) {
    await this.fyn._initialize();
    return this._remove(argv);
  }

  _remove(argv) {
    if (_.isEmpty(argv.packages)) {
      logger.error("No packages to remove");
      fyntil.exit(1);
    }

    const sections = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies"
    ];

    const packages = argv.packages.slice();
    const removed = [];

    const removeFromSection = sec => {
      const section = _.get(this.fyn._pkg, sec);
      const fynSection = _.get(this.fyn._pkg, ["fyn", sec], {});

      if (_.isEmpty(section) && _.isEmpty(fynSection)) return;
      for (let i = 0; i < packages.length; i++) {
        const pkgName = packages[i];
        let found = false;
        if (fynSection.hasOwnProperty(pkgName)) {
          delete fynSection[pkgName];
          found = true;
        }
        if (section.hasOwnProperty(pkgName)) {
          delete section[pkgName];
          found = true;
        }
        if (found) {
          removed.push(pkgName);
          packages[i] = undefined;
        }
      }

      if (_.isEmpty(section)) {
        _.unset(this.fyn._pkg, sec);
      }

      if (_.isEmpty(fynSection)) {
        _.unset(this.fyn._pkg, ["fyn", sec]);
      }
    };

    sections.forEach(removeFromSection);

    const remaining = packages.filter(x => x);
    if (!_.isEmpty(remaining)) {
      logger.error("These packages don't exist in your package.json:", remaining.join(", "));
    }

    if (_.isEmpty(this.fyn._pkg.fyn)) {
      _.unset(this.fyn._pkg, "fyn");
    }

    if (removed.length > 0) {
      logger.info("removed packages from package.json:", removed.join(", "));
      this.fyn.savePkg();
      return true;
    }

    logger.error("No package was removed");

    return false;
  }

  /*
   * npm scripts execution order on install
   * 1. preinstall
   * 1b. install node_modules
   * 2. install
   * 3. postinstall
   * 4. prepare
   */
  install() {
    let failure;
    let installLocked;
    const start = Date.now();
    return Promise.try(() => this.fyn._initializePkg())
      .then(async () => {
        checkNewVersion(this.fyn._options);

        if (
          !this.fyn._changeProdMode &&
          !this.fyn._options.forceInstall &&
          this.fyn._installConfig.time
        ) {
          const stats = await scanFileStats(this.fyn.cwd);
          const { latestMtimeMs } = stats;
          logger.debug(
            "time check from install config - last install time",
            this.fyn._installConfig.time,
            "latest file time",
            latestMtimeMs
          );
          logger.debug("stats", JSON.stringify(stats, null, 2));
          if (
            latestMtimeMs < this.fyn._installConfig.time &&
            !(await this.fyn.checkLocalPkgFromInstallConfigNeedInstall()) &&
            // if fyn-lock.yaml has been removed, then run install also
            this.fyn.checkFynLockExist()
          ) {
            throw new Error("No Change");
          }
        }
        installLocked = await this.fyn.createInstallLock();
        await this.fyn.readLockFiles();
        await this.fyn._startInstall();
        const pkg = this.fyn._pkg;
        const preinstall = _.get(pkg, "scripts.preinstall");
        if (preinstall) {
          logger.addItem({ name: INSTALL_PACKAGE, color: "green", spinner });
          return runNpmScript({
            appDir: this.fyn.cwd,
            scripts: ["preinstall"],
            fyn: this.fyn,
            depInfo: { name: pkg.name, version: pkg.version, dir: this.fyn.cwd }
          }).then(() => {
            logger.removeItem(INSTALL_PACKAGE);
          });
        }
      })
      .then(() => {
        logger.addItem({ name: FETCH_META, color: "green", spinner });
        logger.updateItem(FETCH_META, "resolving dependencies...");
        return this.fyn.resolveDependencies();
      })
      .then(() => {
        logger.removeItem(FETCH_META);
        logger.addItem({ name: FETCH_PACKAGE, color: "green", spinner });
        logger.updateItem(FETCH_PACKAGE, "fetching packages...");
        logger.addItem({ name: LOAD_PACKAGE, color: "green", spinner });
        logger.updateItem(LOAD_PACKAGE, "loading packages...");
        return this.fyn.fetchPackages();
      })
      .then(() => {
        logger.removeItem(FETCH_PACKAGE);
        logger.removeItem(LOAD_PACKAGE);
        logger.addItem({ name: INSTALL_PACKAGE, color: "green", spinner });
        logger.updateItem(INSTALL_PACKAGE, "installing packages...");
        const installer = new PkgInstaller({ fyn: this.fyn });

        return installer.install();
      })
      .then(() => {
        const pkg = this.fyn._pkg;
        const pkgScripts = pkg.scripts || {};
        // https://docs.npmjs.com/cli/v6/using-npm/scripts#npm-install
        // Intentionally skipping the deprecated prepublish
        const scripts = ["install", "postinstall", "prepare"]
          .concat(this.fyn._runNpm)
          .filter(x => x && Boolean(pkgScripts[x]));
        if (scripts.length > 0) {
          return runNpmScript({
            appDir: this.fyn.cwd,
            scripts,
            fyn: this.fyn,
            depInfo: { name: pkg.name, version: pkg.version, dir: this.fyn.cwd }
          });
        }
      })
      .then(async () => {
        logger.removeItem(INSTALL_PACKAGE);
        const end = Date.now();

        logger.info(
          chalk.green("complete in total"),
          chalk.magenta(`${(end - start) / 1000}`) + "secs"
        );
      })
      .catch(err => {
        if (err.message === "No Change") {
          logger.info(`No changes detected since last fyn install - nothing to be done.
  To force install, run 'fyn install --force-install' or 'fyn install --fi'`);
        } else {
          failure = err;
        }
      })
      .finally(async () => {
        if (installLocked === true) {
          await this.fyn.removeInstallLock();
        }

        if (failure) {
          await this.fail(chalk.red("install failed:"), failure);
          return failure;
        }

        if (this._opts.saveLogs) {
          await this.saveLogs(this._opts.saveLogs);
        }

        await this.fyn.saveInstallConfig();

        fyntil.exit(0);
      });
  }

  stat(argv) {
    return showStat(this.fyn, argv.args.packages).finally(() => {
      return this._opts.saveLogs && this.saveLogs(this._opts.saveLogs);
    });
  }

  async run(argv) {
    this._config._fynpo = false;

    if (argv.opts.list || !argv.args.script) {
      try {
        await this.fyn._initialize({ noLock: true });
        if (!argv.opts.list) {
          console.log(`Lifecycle scripts included in ${this.fyn._pkg.name}:\n`);
        }
        console.log(Object.keys(_.get(this.fyn._pkg, "scripts", {})).join("\n"));
      } finally {
        fyntil.exit(0);
      }
    }

    let { script } = argv.args;

    const config = x => this.fyn.allrc[x];

    const run = (pkg, xscr) => {
      const options = {
        config: this.fyn.allrc,
        dir: Path.join(this.fyn.cwd, this.fyn.targetDir),
        failOk: false,
        force: config("force"),
        group: config("group"),
        log: npmlog,
        ignorePrepublish: config("ignore-prepublish"),
        ignoreScripts: config("ignore-scripts"),
        nodeOptions: config("node-options"),
        production: this.fyn.production,
        scriptShell: config("script-shell"),
        scriptsPrependNodePath: config("scripts-prepend-node-path"),
        unsafePerm: config("unsafe-perm"),
        user: config("user")
      };

      return npmLifecycle(pkg, xscr, this.fyn.cwd, options);
    };

    return this.fyn._initialize({ noLock: true }).then(() => {
      if (!_.get(this.fyn._pkg, ["scripts", script])) {
        logger.error(`missing script ${script}`);
        fyntil.exit(1);
      }

      const pkg = Object.assign({}, this.fyn._pkg);

      pkg._id = `${pkg.name}@${pkg.version}`;
      let scripts;

      if (!script.startsWith("pre") && !script.startsWith("post")) {
        scripts = [`pre${script}`, script, `post${script}`];
      } else {
        scripts = [script];
      }

      return Promise.each(scripts, s => _.get(pkg, ["scripts", s]) && run(pkg, s));
    });
  }
}

module.exports = FynCli;
