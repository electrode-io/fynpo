"use strict";

/* eslint-disable max-statements, no-magic-numbers */

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const xsh = require("xsh");
const logger = require("./logger");
const readChangelogVersions = require("./read-changelog-versions");
const Promise = require("bluebird");
const Chalk = require("chalk");
const assert = require("assert");
const semver = require("semver");

// prepare packages for publish

class Prepare {
  constructor({ cwd, tag }, data) {
    this._cwd = cwd;
    this._tag = tag;
    try {
      this._lernaRc = JSON.parse(Fs.readFileSync(Path.join(this._cwd, "lerna.json")));
    } catch (e) {
      this._lernaRc = {};
    }
    this._fynpoRc = this._lernaRc.fynpo || {};
    this._markers = this._fynpoRc.changeLogMarkers || ["## Packages", "## Commits"];
    this._data = data;
    this._versions = {};
    this._tags = [];
  }

  updateDep(pkg, name, ver) {
    ["dependencies", "optionalDependencies"].forEach(sec => {
      const deps = pkg[sec];
      if (_.isEmpty(deps) || !deps.hasOwnProperty(name)) return;
      deps[name] = `^${ver}`;
    });
  }

  _sh(command) {
    return xsh.exec(
      {
        silent: true,
        cwd: this._cwd,
        env: Object.assign({}, process.env, { PWD: this._cwd })
      },
      command
    );
  }

  _checkNupdateTag(pkg, newV) {
    const { pkgJson } = pkg;
    const fynpoTags = _.get(this._lernaRc, "fynpo.publishConfig.tags");
    const versionTagging = _.get(this._lernaRc, "fynpo.publishConfig.versionTagging", {});
    const existPubConfig = _.get(pkgJson, "publishConfig");

    let updated;

    if (fynpoTags) {
      Object.keys(fynpoTags).find(tag => {
        const tagInfo = fynpoTags[tag];
        const tagPkgs = _.get(tagInfo, "packages");
        if (tagInfo.enabled === false || !tagPkgs.hasOwnProperty(pkgJson.name)) {
          return undefined;
        }

        if (tagPkgs[pkgJson.name]) {
          pkgJson.publishConfig = Object.assign({}, pkgJson.publishConfig, { tag });
          return (updated = tag);
        } else if (pkgJson.hasOwnProperty("publishConfig")) {
          delete pkgJson.publishConfig;
          return (updated = "latest");
        }

        return undefined;
      });
    }

    if (versionTagging.hasOwnProperty(pkgJson.name)) {
      assert(!updated, `package ${pkgJson.name} has both tag and verstionTagging`);
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
that's not latest but none set in lerna.json`
        )
      );
      // existPubConfig.tag = "latest";
    }

    pkgJson.version = newV;
  }

  exec() {
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

    // all updated, write to disk
    _.each(this._data.packages, pkg => {
      Fs.writeFileSync(pkg.pkgFile, `${JSON.stringify(pkg.pkgJson, null, 2)}\n`);
    });

    return this._sh(`git add ${packages.map(x => `"${x}"`).join(" ")}`)
      .then(output => {
        logger.info("git add", output);
        return this._sh(`git commit -m Publish -m " - ${this._tags.join("\n - ")}"`);
      })
      .then(output => {
        logger.info("git commit", output);

        if (this._tag === false) {
          return false;
        }
        return Promise.each(this._tags, tag => {
          logger.info("tagging", tag);
          return this._sh(`git tag ${tag}`).then(tagOut => {
            logger.info("tag", tag, "output", tagOut);
          });
        });
      });
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

module.exports = Prepare;
