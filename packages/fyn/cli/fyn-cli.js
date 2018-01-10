"use strict";

const Module = require("module");
const Fs = require("fs");
const Yaml = require("yamljs");
const Path = require("path");
const Fyn = require("../lib/fyn");
const _ = require("lodash");
const PkgInstaller = require("../lib/pkg-installer");
const DepData = require("../lib/dep-data");
const semver = require("semver");
const chalk = require("chalk");
const logger = require("../lib/logger");
const CliLogger = require("../lib/cli-logger");
const PromiseQueue = require("../lib/util/promise-queue");
const sortObjKeys = require("../lib/util/sort-obj-keys");
const exit = require("../lib/util/exit");
const { FETCH_META, FETCH_PACKAGE, LOAD_PACKAGE, INSTALL_PACKAGE } = require("../lib/log-items");

const checkFlatModule = () => {
  const symbols = Object.getOwnPropertySymbols(Module)
    .map(x => x.toString())
    .filter(x => x.indexOf("node-flat-module") >= 0);

  if (symbols.length === 0) {
    logger.fyi("fyn requires", chalk.green("node-flat-module"), "loaded before startup");
    if (!semver.gte(process.versions.node, "8.0.0")) {
      logger.fyi(
        "Your node version",
        chalk.magenta(process.versions.node),
        "doesn't support",
        chalk.green("NODE_OPTIONS")
      );
      logger.fyi("You have to use the", chalk.magenta("-r"), "option explicitly");
    }

    logger.fyi(`See ${chalk.blue("https://github.com/electrode-io/fyn#usage")} for more details.`);

    exit(1);
  }
};

const myPkg = require("./mypkg");
const myDir = Path.join(__dirname, "..");

class FynCli {
  constructor(options) {
    chalk.enabled = options.colors;
    logger.logItem(options.progress);
    this.setLogLevel(options.logLevel);
    this.loadRc(Object.assign({}, options));
    this.setLogLevel(this._rc.logLevel);

    if (options.noStartupInfo !== true) this.showStartupInfo();

    this._fyn = undefined;
  }

  get fyn() {
    if (!this._fyn) this._fyn = new Fyn(this._rc);
    return this._fyn;
  }

  setLogLevel(ll) {
    if (ll) {
      const levels = Object.keys(CliLogger.Levels);
      const real = _.find(levels, l => l.startsWith(ll));
      const x = CliLogger.Levels[real];
      if (x !== undefined) {
        logger._logLevel = x;
      } else {
        logger.error(`Invalid log level "${ll}".  Supported levels are: ${levels.join(", ")}`);
        exit(1);
      }
    }
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
    logger.verbose("working dir is", chalk.magenta(this._rc.cwd));
  }

  loadRc(options) {
    let rcName, rcData;

    try {
      rcName = Path.join(process.env.HOME, ".fynrc");
      rcData = Fs.readFileSync(rcName).toString();
    } catch (err) {
      this._rc = {};
    }

    if (rcData) {
      try {
        this._rc = Yaml.parse(rcData);
      } catch (err) {
        logger.error("failed to parse RC file", rcName);
        logger.error(err.message);
        exit(err);
      }
    }

    logger.debug("loaded RC", JSON.stringify(this._rc));

    if (!this._rc) this._rc = {};

    Object.assign(this._rc, options);

    logger.debug("options", JSON.stringify(options));

    if (!this._rc.cwd) this._rc.cwd = process.cwd();

    this._rc = _.defaults(this._rc, {
      registry: "https://registry.npmjs.org",
      targetDir: "node_modules"
    });
    logger.debug("final RC", JSON.stringify(this._rc));
  }

  saveLogs(dbgLog) {
    Fs.writeFileSync(dbgLog, logger._saveLogs.join("\n") + "\n");
  }

  fail(msg, err) {
    const dbgLog = "fyn-debug.log";
    logger.freezeItems(true);
    logger.error(msg, `CWD ${this.fyn.cwd}`);
    logger.error(msg, "Please check for any errors that occur above.");
    logger.error(msg, `Also check ${chalk.magenta(dbgLog)} for more details.`);
    logger.error(msg, err.message);
    logger.debug("STACK:", err.stack);
    this.saveLogs(dbgLog);
    exit(err);
  }

  add(argv) {
    checkFlatModule();

    const addSec = (section, packages) => {
      if (_.isEmpty(packages)) return [];

      const items = packages.map(x => {
        const fpath = this.fyn.pkgSrcMgr.getSemverAsFilepath(x);
        if (fpath) {
          return {
            $: x,
            name: "",
            semver: x,
            section
          };
        }
        const atX = x.lastIndexOf("@");
        return {
          $: x,
          name: atX > 0 ? x.substr(0, atX) : x,
          semver: atX > 0 ? x.substr(atX + 1) : "latest",
          section
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
    _.each(sections, (argKey, section) => {
      items = items.concat(addSec(section, argv[argKey]));
    });

    if (_.isEmpty(items)) {
      logger.error("No packages to add");
      exit(1);
    }

    const spinner = CliLogger.spinners[1];
    logger.addItem({ name: FETCH_META, color: "green", spinner });
    logger.updateItem(FETCH_META, "loading meta...");

    const results = [];

    return new PromiseQueue({
      concurrency: 10,
      stopOnError: true,
      processItem: item => {
        let found;
        return this.fyn.pkgSrcMgr.fetchMeta(item).then(meta => {
          // logger.info("adding", x.name, x.semver, meta);
          // look at dist tags
          const tags = meta["dist-tags"];
          if (meta.local) {
            logger.info("adding local package at", item.fullPath);
            item.name = meta.name;
            found = Path.relative(this.fyn.cwd, item.fullPath);
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
      watchTime: 5000,
      itemQ: items
    })
      .resume()
      .wait()
      .then(() => {
        logger.remove(FETCH_META);

        if (results.length === 0) {
          logger.info("No packages found for add");
          return false;
        }

        const added = _.mapValues(sections, () => []);

        const pkg = this.fyn._pkg;
        results.forEach(item => {
          _.set(pkg, [item.section, item.name], item.found);
          added[item.section].push(item.name);
        });

        Object.keys(sections).forEach(sec => {
          if (added[sec].length > 0 && pkg[sec]) {
            pkg[sec] = sortObjKeys(pkg[sec]);
            logger.info(`Packages added to ${sec}:`, added[sec].join(", "));
          }
        });

        this.fyn.savePkg();
        return true;
      });
  }

  remove(argv) {
    if (_.isEmpty(argv.packages)) {
      logger.error("No packages to remove");
      exit(1);
    }

    const sections = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies"
    ];

    const packages = argv.packages.slice();

    const removed = [];
    sections.forEach(sec => {
      const section = this.fyn._pkg[sec];
      if (_.isEmpty(section)) return;
      for (let i = 0; i < packages.length; i++) {
        const pkg = packages[i];
        if (section.hasOwnProperty(pkg)) {
          delete section[pkg];
          removed.push(pkg);
          packages[i] = undefined;
        }
      }
    });

    const remaining = packages.filter(x => x);
    if (!_.isEmpty(remaining)) {
      logger.error("These packages don't exist in your package.json:", remaining.join(", "));
    }

    if (removed.length > 0) {
      logger.info("removed packages from package.json:", removed.join(", "));
      this.fyn.savePkg();
      return true;
    }

    logger.error("No package was removed");

    return false;
  }

  install() {
    const spinner = CliLogger.spinners[1];
    checkFlatModule();
    const start = Date.now();
    logger.addItem({ name: FETCH_META, color: "green", spinner });
    logger.updateItem(FETCH_META, "resolving dependencies...");
    return this.fyn
      .resolveDependencies()
      .then(() => {
        logger.remove(FETCH_META);
        logger.addItem({ name: FETCH_PACKAGE, color: "green", spinner });
        logger.updateItem(FETCH_PACKAGE, "fetching packages...");
        logger.addItem({ name: LOAD_PACKAGE, color: "green", spinner });
        logger.updateItem(LOAD_PACKAGE, "loading packages...");
        return this.fyn.fetchPackages();
      })
      .then(() => {
        logger.remove(FETCH_PACKAGE);
        logger.remove(LOAD_PACKAGE);
        logger.addItem({ name: INSTALL_PACKAGE, color: "green", spinner });
        logger.updateItem(INSTALL_PACKAGE, "installing packages...");
        const installer = new PkgInstaller({ fyn: this.fyn });

        return installer.install();
      })
      .then(() => {
        logger.remove(INSTALL_PACKAGE);
        const end = Date.now();
        logger.info(
          chalk.green("complete in total"),
          chalk.magenta(`${(end - start) / 1000}`) + "secs"
        );
        if (typeof this._rc.saveLogs === "string") {
          this.saveLogs(this._rc.saveLogs || "fyn-debug.log");
        }
      })
      .catch(err => {
        this.fail(chalk.red("install failed:"), err);
      });
  }
}

module.exports = FynCli;
