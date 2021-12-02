/*
 * Looks at each commit that is not a "Merge pull request", figure out
 * the packages it modified and group the commit messages by package.
 *
 * Then check for [major], [minor], [patch] in the commit message, and
 * automatically generate the new package tag name with the would be
 * updated version.
 *
 * Write all these to the file CHANGELOG.md.
 *
 */

/* eslint-disable complexity, consistent-return, max-depth */

import Fs from "fs";
import xsh from "xsh";
import Path from "path";
import Promise from "bluebird";
xsh.Promise = Promise;
xsh.envPath.addToFront(Path.join(__dirname, "../node_modules/.bin"));
import _ from "lodash";
import * as utils from "./utils";
import { logger } from "./logger";
import { getUpdatedPackages } from "./utils/get-updated-packages";
import { determinePackageVersions } from "./utils/get-package-version";
import { updateChangelog } from "./utils/update-changelog-file";
import { updatePackageVersions } from "./utils/update-package-versions";
import { getCurrentBranch } from "./utils/get-current-branch";
import {
  isAnythingCommitted,
  getNewCommits,
  collateCommitsPackages,
} from "./utils/git-list-commits";
import { FynpoDepGraph } from "@fynpo/base";

export class Version {
  name;
  _cwd;
  _fynpoRc;
  _options;
  _changeLog;
  _changeLogFile;
  _versionLockMap;
  _gitClean;
  _graph: FynpoDepGraph;

  constructor(opts, graph: FynpoDepGraph) {
    this.name = "version";
    this._cwd = opts.cwd;
    this._fynpoRc = opts;
    this._graph = graph;

    const commandConfig = (this._fynpoRc as any).command || {};
    const overrides = [this.name, ...this.relatedCommands].map((key) => commandConfig[key]);
    this._options = _.defaults(opts, ...overrides, this._fynpoRc);

    const versionLocks = _.get(this._fynpoRc, "versionLocks", []);
    if (versionLocks[0] && versionLocks[0] === "*") {
      this._versionLockMap = utils.makeVersionLockMap([["name:/.*/"]], graph);
    } else {
      this._versionLockMap = utils.makeVersionLockMap(versionLocks, graph);
    }

    try {
      this._changeLogFile = Path.resolve("CHANGELOG.md");
      this._changeLog = Fs.readFileSync(this._changeLogFile).toString();
    } catch {
      this._changeLogFile = Path.join(this._cwd, "CHANGELOG.md");
      this._changeLog = "";
    }
  }

  get relatedCommands() {
    return ["changelog", "updated", "prepare"];
  }

  _sh(command) {
    return xsh.exec(
      {
        silent: true,
        cwd: this._cwd,
        env: Object.assign({}, process.env, { PWD: this._cwd }),
      },
      command
    );
  }

  checkGitClean = () => {
    return this._sh(`git diff --quiet`)
      .then(() => (this._gitClean = true))
      .catch(() => (this._gitClean = false));
  };

  commitAndTagUpdates = ({ packages, tags }) => {
    if (!this._options.commit) {
      logger.warn("commit option disabled, skip committing updates.");
      return;
    }

    if (!this._gitClean) {
      logger.warn("Your git branch is not clean, skip committing updates.");
      return;
    }

    return this._sh(`git add ${this._changeLogFile} ${packages.map((x) => `"${x}"`).join(" ")}`)
      .then((output) => {
        logger.info("git add", output);
        return this._sh(`git commit -n -m "[Publish]" -m " - ${tags.join("\n - ")}"`);
      })
      .then((output) => {
        logger.info("git commit", output);

        if (this._options.tag === false) {
          return false;
        }

        return Promise.each(tags, (tag) => {
          logger.info("tagging", tag);
          return this._sh(`git tag ${tag}`).then((tagOut) => {
            logger.info("tag", tag, "output", tagOut);
          });
        });
      });
  };

  async exec() {
    const execOpts = {
      cwd: this._cwd,
    };
    if (!isAnythingCommitted(execOpts)) {
      logger.error("No commits in this repository. Please commit something before using version.");
      return;
    }

    const currentBranch = getCurrentBranch(execOpts);

    if (currentBranch === "HEAD") {
      logger.error("Detached git HEAD, please checkout a branch to choose versions.");
      process.exit(1);
    }

    const opts = Object.assign({}, this._options, {
      cwd: this._cwd,
      changeLog: this._changeLog,
      changeLogFile: this._changeLogFile,
      fynpoRc: this._fynpoRc,
      versionLockMap: this._versionLockMap,
      graph: this._graph,
    });
    const changed = getUpdatedPackages(this._graph, opts);

    if (!changed.pkgs.length) {
      logger.info(`No changed packages to version`);
      return;
    }

    const messages = changed.pkgs.map((name) => ` - ${name}`);
    logger.info(`Changed packages: \n${messages.join("\n")}`);

    await this.checkGitClean();

    return getNewCommits(opts, changed)
      .then(collateCommitsPackages)
      .then(determinePackageVersions)
      .then(updateChangelog)
      .then(updatePackageVersions)
      .then(this.commitAndTagUpdates);
  }
}
