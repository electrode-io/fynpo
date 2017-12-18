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
    this.loadRc(options);
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

    logger.verbose(chalk.green("fyn"), "version", myPkg.version, "at", chalk.magenta(myDir));
    logger.verbose(
      chalk.green("NodeJS"),
      "version",
      process.version,
      "at",
      chalk.magenta(process.execPath)
    );
    logger.verbose("env NODE_OPTIONS is", chalk.magenta(process.env.NODE_OPTIONS));
    logger.verbose("CWD is", chalk.magenta(process.cwd()));
    this._fyn = new Fyn(this._rc);
  }

  loadRc(options) {
    try {
      const rcName = Path.join(process.env.HOME, ".fynrc");
      const rcData = Fs.readFileSync(rcName).toString();
      this._rc = Yaml.safeLoad(rcData);
      Object.assign(this._rc, options);
    } catch (err) {
      this._rc = Object.assign({}, options);
    }
    this._rc = _.defaults(this._rc, {
      registry: "https://registry.npmjs.org",
      targetDir: "node_modules"
    });
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
