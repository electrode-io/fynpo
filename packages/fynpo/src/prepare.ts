/* eslint-disable max-statements, no-magic-numbers, consistent-return */

import Fs from "fs";
import Path from "path";
import _ from "lodash";
import xsh from "xsh";
import { logger } from "./logger";
import { readChangelogVersions } from "./read-changelog-versions";
import Promise from "bluebird";
import Chalk from "chalk";
import assert from "assert";
import semver from "semver";
import * as utils from "./utils";
// prepare packages for publish

export class Prepare {
  name;
  _cwd;
  _fynpoRc;
  _markers;
  _data;
  _versions;
  _tags;
  _options;
  _gitClean;

  constructor(opts, data) {
    this.name = "prepare";
    this._cwd = opts.cwd;

    const { fynpoRc, dir } = utils.loadConfig(this._cwd);

    this._cwd = dir || opts.cwd;
    this._fynpoRc = fynpoRc || {};

    this._markers = this._fynpoRc.changeLogMarkers || ["## Packages", "## Commits"];
    this._data = data;
    this._versions = {};
    this._tags = [];

    const commandConfig = (this._fynpoRc as any).command || {};
    const overrides = commandConfig[this.name];
    this._options = _.defaults(opts, overrides, this._fynpoRc);
  }

  updateDep(pkg, name, ver) {
    ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"].forEach(
      (sec) => {
        const deps = pkg[sec];
        if (_.isEmpty(deps) || !deps.hasOwnProperty(name)) {
          return;
        }

        let semType = "";
        const sem = deps[name][0];

        if (sem.match(/[\^~]/)) {
          semType = sem;
        } else if (!sem.match(/[0-9]/)) {
          return;
        }

        deps[name] = `${semType}${ver}`;
      }
    );
  }

  checkGitClean = () => {
    return this._sh(`git diff --quiet`)
      .then(() => (this._gitClean = true))
      .catch(() => (this._gitClean = false));
  };

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

  _checkNupdateTag(pkg, newV) {
    const { pkgJson } = pkg;
    const fynpoTags = _.get(this._fynpoRc, "command.publish.tags");
    const versionTagging = _.get(this._fynpoRc, "command.publish.versionTagging", {});
    const existPubConfig = _.get(pkgJson, "publishConfig");

    let updated;

    if (fynpoTags) {
      Object.keys(fynpoTags).find((tag) => {
        const tagInfo = fynpoTags[tag];
        if (tagInfo.enabled === false) {
          return undefined;
        }

        let enabled = _.get(tagInfo, ["packages", pkgJson.name]);

        if (enabled === undefined && tagInfo.regex) {
          enabled = Boolean(tagInfo.regex.find((r) => new RegExp(r).exec(pkgJson.name)));
        }

        const tagPkgs = _.get(tagInfo, "packages");
        if (tagInfo.enabled === false || !tagPkgs.hasOwnProperty(pkgJson.name)) {
          return undefined;
        }

        if (!enabled) {
          // npm tag not enabled for package
          if (pkgJson.publishConfig) {
            // remove tag from package.json if it exist
            delete pkgJson.publishConfig.tag;
          }
          // default to latest tag
          return (updated = "latest");
        }

        // enabled, update tag in package.json
        pkgJson.publishConfig = Object.assign({}, pkgJson.publishConfig, { tag });
        return (updated = tag);
      });
    }

    if (versionTagging.hasOwnProperty(pkgJson.name)) {
      assert(!updated, `package ${pkgJson.name} has both tag and versionTagging`);
      const semv = semver.parse(newV);
      const tag = `ver${semv.major}`;
      pkgJson.publishConfig = Object.assign({}, pkgJson.publishConfig, { tag });
      updated = tag;
    }

    // reset exist tag to latest in case lerna config
    if (existPubConfig && !updated && existPubConfig.tag && existPubConfig.tag !== "latest") {
      logger.warn(
        Chalk.red(
          `Pkg ${pkgJson.name} has exist publishConfig.tag ${existPubConfig.tag} \
that's not latest but none set in fynpo config`
        )
      );
      // existPubConfig.tag = "latest";
    }

    pkgJson.version = newV;
  }

  commitAndTagUpdates = (packages) => {
    if (!this._options.commit) {
      logger.warn("commit option disabled, skip committing updates.");
      return;
    }

    if (!this._gitClean) {
      logger.warn("Your git branch is not clean, skip committing updates.");
      return;
    }

    return this._sh(`git add ${packages.map((x) => `"${x}"`).join(" ")}`)
      .then((output) => {
        logger.info("git add", output);
        return this._sh(`git commit -n -m "[Publish]" -m " - ${this._tags.join("\n - ")}"`);
      })
      .then((output) => {
        logger.info("git commit", output);

        if (this._options.tag === false) {
          return false;
        }

        return Promise.each(this._tags, (tag) => {
          logger.info("tagging", tag);
          return this._sh(`git tag ${tag}`).then((tagOut) => {
            logger.info("tag", tag, "output", tagOut);
          });
        });
      });
  };

  async exec() {
    this.readChangelog();
    if (_.isEmpty(this._versions)) {
      logger.error("No versions found in CHANGELOG.md");
      return undefined;
    }

    const packages = [];

    _.each(this._data.packages, (pkg, name) => {
      if (!this._versions.hasOwnProperty(name)) return;

      const newV = this._versions[name];
      if (newV === pkg.version) return;

      if (pkg.private === true) {
        logger.info("skipping private package", pkg.name);
        return;
      }

      this._checkNupdateTag(pkg, newV);

      _.each(this._versions, (ver, name2) => {
        this.updateDep(pkg.pkgJson, name2, ver);
      });

      packages.push(Path.join("packages", pkg.pkgDir, "package.json"));
    });

    await this.checkGitClean();

    // all updated, write to disk
    _.each(this._data.packages, (pkg) => {
      Fs.writeFileSync(pkg.pkgFile, `${JSON.stringify(pkg.pkgJson, null, 2)}\n`);
    });

    return this.commitAndTagUpdates(packages);
  }

  readChangelog() {
    const fromCl = readChangelogVersions(this._cwd, this._data.packages, this._markers);
    this._versions = fromCl.versions;
    this._tags = fromCl.tags;
    if (this._tags.length) {
      logger.info("Found these versions from CHANGELOG");

      const names = [];
      _.each(this._versions, (ver, name) => {
        logger.info("  ", name, ver);
        names.push(name);
      });

      logger.info("tags", this._tags.join(", "));

      logger.info("packages to be published:", names.join(" "));
    }
  }
}
