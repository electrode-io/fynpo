"use strict";

const Module = require("module");
const Fs = require("fs");
const Yaml = require("js-yaml");
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

    process.exit(1);
  }
};

const myPkg = require("../package.json");
const myDir = Path.join(__dirname, "..");

class FynCli {
  constructor(options) {
    this.loadRc(Object.assign({}, options));
    const ll = this._rc.logLevel;
    if (ll) {
      const levels = Object.keys(CliLogger.Levels);
      const real = _.find(levels, l => l.startsWith(ll));
      const x = CliLogger.Levels[real];
      if (x !== undefined) {
        logger._logLevel = x;
      } else {
        logger.error(`Invalid log level "${ll}".  Supported levels are: ${levels.join(", ")}`);
        process.exit(1);
      }
    }

    if (options.noStartupInfo !== true) this.showStartupInfo();

    this._fyn = new Fyn(this._rc);
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
    } catch (err) {}

    if (rcData) {
      try {
        this._rc = Yaml.safeLoad(rcData);
      } catch (err) {
        logger.error("failed to parse RC file", rcName);
        logger.error(err.message);
        process.exit(1);
      }
    }
    logger.debug("loaded RC", JSON.stringify(this._rc));

    Object.assign(this._rc, options);

    logger.debug("options", JSON.stringify(options));

    if (!this._rc.cwd) this._rc.cwd = process.cwd();

    this._rc = _.defaults(this._rc, {
      registry: "https://registry.npmjs.org",
      targetDir: "node_modules"
    });
    logger.debug("final RC", JSON.stringify(this._rc));
  }

  fail(err, msg) {
    const dbgLog = "fyn-debug.log";
    logger.freezeItems(true);
    logger.error(msg, "Please check for any errors that occur above.");
    logger.error(msg, `Also check ${chalk.magenta(dbgLog)} for more details.`);
    logger.error(msg, err.message);
    logger.debug("STACK:", err.stack);
    Fs.writeFileSync(dbgLog, logger._saveLogs.join("\n") + "\n");
  }

  add(argv) {
    const spinner = CliLogger.spinners[1];
    if (!argv.packages || argv.packages.length < 1) {
      logger.error("No packages to add");
      process.exit(1);
    }
    const sections = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies"
    ];
    const inSec = sections.find(x => x.startsWith(argv.in));

    if (!inSec) {
      logger.error("Invalid section to add, should be one of:", sections.join(", "));
      process.exit(1);
    }

    logger.info("adding packages", argv.packages, "to", inSec);
    checkFlatModule();
    logger.addItem({ name: FETCH_META, color: "green", spinner });
    logger.updateItem(FETCH_META, "loading meta...");
    const items = argv.packages.map(x => {
      const fpath = this._fyn.pkgSrcMgr.getSemverAsFilepath(x);
      if (fpath) {
        return {
          $: x,
          name: "",
          semver: x
        };
      }
      const atX = x.lastIndexOf("@");
      return {
        $: x,
        name: atX > 0 ? x.substr(0, atX) : x,
        semver: atX > 0 ? x.substr(atX + 1) : "latest"
      };
    });

    const results = [];

    return new PromiseQueue({
      concurrency: 10,
      stopOnError: true,
      processItem: item => {
        let found;
        return this._fyn.pkgSrcMgr.fetchMeta(item).then(meta => {
          // logger.info("adding", x.name, x.semver, meta);
          // look at dist tags
          const tags = meta["dist-tags"];
          if (meta.local) {
            logger.info("adding local package at", item.fullPath);
            item.name = meta.name;
            found = Path.relative(this._fyn.cwd, item.fullPath);
          } else if (tags && tags[item.semver]) {
            logger.info("adding with dist tag", item.semver, tags[item.semver]);
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
        const pkg = this._fyn._pkg;
        if (!pkg[inSec]) pkg[inSec] = {};
        const sec = pkg[inSec];
        if (results.length > 0) {
          results.forEach(item => {
            sec[item.name] = item.found;
          });
          this._fyn.savePkg();
          logger.info("packages added to", inSec);
          return true;
        } else {
          logger.info("No packages found for add to", inSec);
          return false;
        }
      });
  }

  install() {
    const spinner = CliLogger.spinners[1];
    checkFlatModule();
    const start = Date.now();
    logger.addItem({ name: FETCH_META, color: "green", spinner });
    logger.updateItem(FETCH_META, "resolving dependencies...");
    return this._fyn
      .resolveDependencies()
      .then(() => {
        logger.remove(FETCH_META);
        logger.addItem({ name: FETCH_PACKAGE, color: "green", spinner });
        logger.updateItem(FETCH_PACKAGE, "fetching packages...");
        logger.addItem({ name: LOAD_PACKAGE, color: "green", spinner });
        logger.updateItem(LOAD_PACKAGE, "loading packages...");
        return this._fyn.fetchPackages();
      })
      .then(() => {
        logger.remove(FETCH_PACKAGE);
        logger.remove(LOAD_PACKAGE);
        logger.addItem({ name: INSTALL_PACKAGE, color: "green", spinner });
        logger.updateItem(INSTALL_PACKAGE, "installing packages...");
        const installer = new PkgInstaller({ fyn: this._fyn });

        return installer.install();
      })
      .then(() => {
        logger.remove(INSTALL_PACKAGE);
        const end = Date.now();
        logger.info(
          chalk.green("complete in total"),
          chalk.magenta(`${(end - start) / 1000}`) + "secs"
        );
      })
      .catch(err => {
        this.fail(err, chalk.red("install failed:"));
      });
  }
}

module.exports = FynCli;
