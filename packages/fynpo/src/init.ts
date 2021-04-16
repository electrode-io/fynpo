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

    const { fynpoRc, dir, fileName } = utils.loadConfig(this._cwd, opts.commitlint);
    this._cwd = dir || opts.cwd;
    this._config = fynpoRc || {};
    this._configFile = fileName;

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

    if (version) {
      target[depName] = this._options.exact ? version : `^${version}`;
    }
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
      this.addDependency(rootPkg, "@commitlint/config-conventional", "12.0.1");
      this.addDependency(rootPkg, "husky", "5.1.3");

      const scripts = rootPkg.scripts || {};
      rootPkg.scripts = scripts;
      const prepareScript = scripts.prepare || "";

      if (!prepareScript.includes("husky install")) {
        const prepare = (prepareScript.length > 0 && prepareScript.concat(" && ")) || "";
        rootPkg.scripts = {
          ...scripts,
          prepare: prepare.concat("husky install"),
        };
      }
    }

    fs.writeFileSync(Path.join(this._cwd, "package.json"), `${JSON.stringify(rootPkg, null, 2)}\n`);
    logger.info(`${pkgMsg} package.json at ${this._cwd}.`);
  };

  updateFynpoConfig = () => {
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

    if (
      this._configFile.endsWith(".json") &&
      this._options.commitlint &&
      !this._config.commitlint
    ) {
      logger.info(
        "Creating fynpo.config.js for you as some of the commitlint config requires javascript."
      );

      const lintConfig = utils.generateLintConfig();
      const finalConfig = Object.assign({}, this._config, { commitlint: lintConfig });

      const obj = JSON.stringify(finalConfig, jsonReplacer)
        .replace(/"\{fynpo_func_(\d+)\}"/g, funcReplacer)
        .replace(/"\{fynpo_regexp_(\d+)\}"/g, regexReplacer);
      const output = prettier.format(
        `"use strict";\n
          module.exports = ${obj}`,
        { semi: true, parser: "flow" }
      );
      fs.writeFileSync(Path.join(this._cwd, "fynpo.config.js"), output);
      logger.info(`Created fynpo.config.js at ${this._cwd}.`);
      logger.info(`Please delete ${this._configFile}.`);
    }
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
      .then(this.updateFynpoConfig)
      .then(this.addPackagesDirs)
      .then(() => {
        const commitHookMsg = this._options.commitlint
          ? `\nTo add commit hooks, please run:
        <cyan>
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
