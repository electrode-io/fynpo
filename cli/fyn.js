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
const { FETCH_META, LOAD_PACKAGE } = require("../lib/log-items");

const checkFlatModule = () => {
  const symbols = Object.getOwnPropertySymbols(Module)
    .map(x => x.toString())
    .filter(x => x.indexOf("node-flat-module") >= 0);

  if (symbols.length === 0) {
    console.log("fyn requires", chalk.green("node-flat-module"), "loaded before startup");
    if (!semver.gte(process.versions.node, "8.0.0")) {
      console.log(
        "Your node version",
        chalk.magenta(process.versions.node),
        "doesn't support",
        chalk.green("NODE_OPTIONS"),
        "\nYou have to use the",
        chalk.magenta("-r"),
        "option explicitly"
      );
    }

    process.exit(1);
  }
};

class FynCli {
  constructor() {
    this.loadRc();
    this._fyn = new Fyn(this._rc);
  }

  loadRc() {
    try {
      const rcName = Path.join(process.env.HOME, ".fynrc");
      const rcData = Fs.readFileSync(rcName).toString();
      this._rc = Yaml.safeLoad(rcData);
    } catch (err) {
      this._rc = {};
    }
    this._rc = _.defaults(this._rc, {
      registry: "https://registry.npmjs.org",
      targetDir: "node_modules"
    });
  }

  install() {
    checkFlatModule();
    const start = Date.now();
    logger.addItem({ name: FETCH_META, color: "green" });
    logger.updateItem(FETCH_META, "resolving dependencies...");
    return this._fyn
      .resolveDependencies()
      .then(() => {
        logger.remove(FETCH_META);
        logger.addItem({ name: LOAD_PACKAGE, color: "green" });
        logger.updateItem(LOAD_PACKAGE, "loading packages...");
        return this._fyn.fetchPackages();
      })
      .then(() => {
        logger.remove(LOAD_PACKAGE);
        const installer = new PkgInstaller({ fyn: this._fyn });

        return installer.install();
      })
      .then(() => {
        const end = Date.now();
        logger.info(
          chalk.green("complete in total"),
          chalk.magenta(`${(end - start) / 1000}`) + "secs"
        );
      })
      .catch(err => {
        logger.error("install failed", err);
      });
  }

  bash() {
    const file = Path.join(__dirname, "..", "flat-module.js");
    console.log(`export NODE_OPTIONS="-r ${file}"`);
  }
}

const cli = new FynCli();
cli.install();
// cli.bash();
