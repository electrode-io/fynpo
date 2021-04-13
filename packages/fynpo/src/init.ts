/* eslint-disable consistent-return */

import xsh from "xsh";
import fs from "fs-extra";
import Path from "path";
import logger from "./logger";
import * as utils from "./utils";
import _ from "lodash";
import ck from "chalker";
import prettier from "prettier";

export default class Init {
  _cwd;
  _options;
  _config;
  name;
  _configFile;

  constructor(opts) {
    this.name = "init";
    this._cwd = opts.cwd;

    const loaded = utils.loadFynpoConfig(this._cwd);
    if (loaded && !loaded.isEmpty) {
      this._cwd = loaded.filepath ? Path.dirname(loaded.filepath) : opts.cwd;
      this._config = loaded.config || {};
      this._configFile = Path.basename(loaded.filepath);
    } else {
      const { config, dir } = utils._searchForFynpo(opts.cwd);
      this._cwd = (config && dir) || opts.cwd;
      this._config = config || {};
      this._configFile = "fynpo.json";
    }

    const commandConfig = (this._config as any).command || {};
    const overrides = commandConfig[this.name] || {};
    this._options = _.defaults(opts, overrides, this._config);
  }

  _sh(command, cwd = this._cwd, silent = true) {
    return xsh.exec(
      {
        silent,
        cwd,
        env: Object.assign({}, process.env, { PWD: cwd }),
      },
      command
    );
  }

  isGitInitialized = () => {
    return this._sh(`git rev-parse --git-dir`)
      .then(() => true)
      .catch(() => false);
  };

  getFynpoVersion = () => {
    return utils.getGlobalFynpo().then((globalFynpo) => {
      return globalFynpo.version;
    });
  };

  addDependency = (rootPkg, depName, version) => {
    let target;
    const dep = _.get(rootPkg, ["dependencies", depName]);
    if (dep) {
      target = rootPkg.dependencies;
    } else {
      rootPkg.devDependencies ??= {};
      target = rootPkg.devDependencies;
    }

    target[depName] = this._options.exact ? version : `^${version}`;
  };

  updatePackageJson = (fynpoVersion) => {
    let rootPkg;
    let pkgMsg;
    try {
      rootPkg = JSON.parse(fs.readFileSync(Path.join(this._cwd, "package.json")).toString());
      pkgMsg = "Updated";
    } catch {
      pkgMsg = "Created";
      rootPkg = { name: "root", private: true };
    }

    this.addDependency(rootPkg, "fynpo", fynpoVersion);

    if (this._options.commitlint) {
      this.addDependency(rootPkg, "@commitlint/cli", "12.0.1");
      this.addDependency(rootPkg, "@commitlint/config-conventional", "12.0.1");
      this.addDependency(rootPkg, "husky", "5.1.3");
    }

    fs.writeFileSync(Path.join(this._cwd, "package.json"), `${JSON.stringify(rootPkg, null, 2)}\n`);
    logger.info(`${pkgMsg} package.json at ${this._cwd}.`);
  };

  addFynpoConfig = () => {
    let configMsg;
    if (_.isEmpty(this._config)) {
      configMsg = "Created";
    } else {
      configMsg = "Updated";
    }

    const functions = [];
    const regExps = [];

    const jsonReplacer = (key, val) => {
      if (typeof val === "function") {
        functions.push(val.toString());
        return "{fynpo_func_" + (functions.length - 1) + "}";
      } else if (val instanceof RegExp) {
        regExps.push(val.toString());
        return "{fynpo_regexp_" + (regExps.length - 1) + "}";
      }
      return val;
    };

    const funcReplacer = function (match, id) {
      return functions[id];
    };

    const regexReplacer = function (match, id) {
      return regExps[id];
    };

    const finalConfig = utils.generateFynpoConfig(this._config, this._options);

    let output;
    if (this._configFile === "fynpo.config.js" || this._options.commitlint) {
      this._configFile = "fynpo.config.js";
      const obj = JSON.stringify(finalConfig, jsonReplacer)
        .replace(/"\{fynpo_func_(\d+)\}"/g, funcReplacer)
        .replace(/"\{fynpo_regexp_(\d+)\}"/g, regexReplacer);
      output = prettier.format(
        `"use strict";\n
          module.exports = ${obj}`,
        { semi: true, parser: "flow" }
      );
    } else {
      output = prettier.format(`${JSON.stringify(finalConfig, null, 2)}\n`, {
        semi: true,
        parser: "json",
      });
    }

    fs.writeFileSync(Path.join(this._cwd, this._configFile), output);

    logger.info(`${configMsg} ${this._configFile} at ${this._cwd}.`);
  };

  addPackagesDirs = () => {
    const pkgDir = Path.resolve(this._cwd, "packages");
    return fs.mkdirp(pkgDir);
  };

  async exec() {
    return this.isGitInitialized()
      .then((isGit) => {
        if (!isGit) {
          logger.info("Initializing Git repository");
          return this._sh("git init");
        }
      })
      .then(this.getFynpoVersion)
      .then(this.updatePackageJson)
      .then(this.addFynpoConfig)
      .then(this.addPackagesDirs)
      .then(() => {
        const commitHookMsg = this._options.commitlint
          ? `\nTo add commit hooks, please run:
        <cyan>
        npx husky install
        npx husky add .husky/commit-msg 'npx --no-install fynpo commitlint --edit $1'</>
        `
          : "";

        console.log(ck`
Successfully initialized fynpo repo. Please run:
<cyan>
fyn</>
${commitHookMsg}
`);
      });
  }
}
