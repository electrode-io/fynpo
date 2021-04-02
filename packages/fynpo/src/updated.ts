/* reuses some of the logics from https://github.com/lerna/lerna/blob/main/commands/changed/index.js */
import * as utils from "./utils";
import logger from "./logger";
import { execSync } from "./child-process";
import _ from "lodash";
import path from "path";
import slash from "slash";
import minimatch from "minimatch";

export default class Updated {
  _cwd;
  _options;
  name;
  _packages;

  constructor(opts, data) {
    this.name = "updated";
    const { dir, fynpoRc } = utils.loadConfig(this._cwd);
    this._cwd = dir || opts.cwd;
    this._packages = data.packages;

    const commandConfig = (fynpoRc as any).command || {};
    const overrides = [this.name, ...this.relatedCommands].map((key) => commandConfig[key]);
    this._options = _.defaults(opts, ...overrides, fynpoRc);
  }

  get relatedCommands() {
    return ["changelog"];
  }

  ifTagExists(execOptions) {
    let result = false;

    try {
      result = !!execSync("git", ["tag", "--list", "fynpo-rel-*"], execOptions);
    } catch (err) {
      logger.warn("Can't find latest release tag from this branch!");
    }

    return result;
  }

  getLatestTag(execOptions) {
    const args = ["describe", "--long", "--first-parent", "--match", "fynpo-rel-*"];
    const stdout = execSync("git", args, execOptions);
    const [, tagName, commitCount, sha] = /^(.*)-(\d+)-g([0-9a-f]+)$/.exec(stdout) || [];
    return { tagName, commitCount, sha };
  }

  addDependents(name, updates) {
    const dependents = _.get(this._packages, [name, "dependents"], {});
    dependents.forEach((dep) => {
      if (!updates.includes(dep)) {
        updates.push(dep);
      }
    });
  }

  getUpdatedPackages(execOptions) {
    let latestTag;
    const updates = [];
    const forced = this._options.forcePublish || [];

    if (this.ifTagExists(execOptions)) {
      const { tagName, commitCount } = this.getLatestTag(execOptions);

      if (commitCount === "0" && forced.length === 0) {
        logger.info("No commits since previous release. Skipping change detection");
        return [];
      }

      latestTag = tagName;
    }

    if (!latestTag || forced.includes("*")) {
      logger.info("Assuming all packages changed.");
      Object.keys(this._packages).forEach((name) => {
        updates.push(name);
      });
    } else {
      logger.info(`Detecting changed packages since the release tag: ${latestTag}`);

      const ignoreChanges = this._options.ignoreChanges || [];
      if (ignoreChanges.length) {
        logger.info("Ignoring changes in files matching patterns:", ignoreChanges);
      }
      const filterFunctions = ignoreChanges.map((p) =>
        minimatch.filter(`!${p}`, {
          matchBase: true,
          dot: true,
        })
      );

      const isForced = (name) => {
        if (forced.includes("*") || forced.includes(name)) {
          logger.info(`force updating package: ${name}`);
          return true;
        }
        return false;
      };

      const isChanged = (name) => {
        const pkg = this._packages[name];

        const args = ["diff", "--name-only", latestTag];
        const pathArg = slash(path.relative(this._cwd, pkg.path));
        if (pathArg) {
          args.push("--", pathArg);
        }

        const diff = execSync("git", args, execOptions);
        if (diff === "") {
          return false;
        }

        let changedFiles = diff.split("\n");
        if (filterFunctions.length) {
          for (const filerFn of filterFunctions) {
            changedFiles = changedFiles.filter(filerFn);
          }
        }

        return changedFiles.length > 0;
      };

      Object.keys(this._packages).forEach((name) => {
        if (isForced(name) || isChanged(name)) {
          updates.push(name);
        }
      });

      updates.forEach((name) => {
        this.addDependents(name, updates);
      });
    }

    return updates;
  }

  exec() {
    const execOptions = {
      cwd: this._cwd,
    };
    const updates = this.getUpdatedPackages(execOptions);

    if (!updates.length) {
      logger.info(`No changed packages!`);
      return;
    }

    const messages = updates.map((name) => ` - ${name}`);
    logger.info(`Changed packages: \n${messages.join("\n")}`);
  }
}
