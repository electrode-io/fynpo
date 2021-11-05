/* eslint-disable complexity, consistent-return, max-depth */

import _ from "lodash";
import * as utils from "../utils";
import semver from "semver";
import logger from "../logger";

const findVersion = (name, updateType, collated) => {
  const types = ["patch", "minor", "major"];
  const pkg = collated.opts.graph.getPackageByName(name);
  const pkgJson = _.get(pkg, "pkgJson", {});
  collated.packages[name] = collated.packages[name] || {};

  collated.packages[name].version = pkgJson.version;
  const x = semver.parse(pkgJson.version);
  collated.packages[name].versionOnly = `${x.major}.${x.minor}.${x.patch}`;
  collated.packages[name].semver = x;
  collated.packages[name].newVersion = semver.inc(
    collated.packages[name].versionOnly,
    types[updateType]
  );
  collated.packages[name].updateType = updateType;
  collated.packages[name].originalPkg = pkgJson;
};

const findUpdateType = (name, collated, minBumpType = 0) => {
  const opts = collated.opts || {};
  const lintConfig = opts.fynpoRc.commitlint;
  const parserOpts = _.get(lintConfig, "parserPreset.parserOpts", {});

  const minorTypes = _.get(lintConfig, "minor", ["feat", "minor"]);
  const majorTypes = _.get(lintConfig, "major", ["breaking", "major"]);

  collated.packages[name] = collated.packages[name] || {};
  const msgs = collated.packages[name].msgs || [];

  const updateType = msgs.reduce((a, x) => {
    const parsed: any = utils.lintParser(x.m, parserOpts);
    if ((parsed.type && majorTypes.includes(parsed.type)) || x.m.indexOf("[maj") >= 0) {
      if (a < 2) {
        a = 2;
      }
    } else if ((parsed.type && minorTypes.includes(parsed.type)) || x.m.indexOf("[min") >= 0) {
      if (a < 1) {
        a = 1;
      }
    }
    return a;
  }, minBumpType);

  collated.packages[name].updateType = updateType;
};

export const determinePackageVersions = (collated) => {
  const opts = collated.opts || {};
  const changed = collated.changed || {};

  // find bump type for packages that have direct changes
  collated.realPackages.forEach((name) => findUpdateType(name, collated));

  // If all packages are version locked, bump all the packages to the highest type
  if (opts.lockAll) {
    const updateTypes = collated.realPackages
      .map((name) => collated.packages[name])
      .map((x) => x.updateType);
    const minBumpType = _.max(updateTypes);
    const pkgNames = Object.keys(_.get(collated, "opts.graph.packages.byName", {}));

    for (const name of pkgNames) {
      if (!collated.realPackages.includes(name)) {
        collated.realPackages.push(name);
      }
      findVersion(name, minBumpType, collated);
    }

    const directBumps = collated.realPackages.filter(
      (name) => collated.packages[name] && collated.packages[name].newVersion
    );
    collated.directBumps = directBumps;
    collated.indirectBumps = [];
    return Promise.resolve(collated);
  }

  // check for forceUpdated packages

  changed.forceUpdated.forEach((name) => {
    if (!collated.realPackages.includes(name)) {
      collated.realPackages.push(name);
      findUpdateType(name, collated);
    } else {
      const pkgType = _.get(collated.packages, [name, "updateType"], 0);
      const updateType = _.max([collated.packages[name].updateType, pkgType]);
      collated.packages[name].updateType = updateType;
    }
  });

  // check for version locking of direct bump packages
  collated.realPackages.forEach((name) => {
    const verLocks = changed.verLocks[name];
    if (verLocks) {
      for (const lockPkgName of verLocks) {
        if (!collated.realPackages.includes(lockPkgName)) {
          collated.realPackages.push(lockPkgName);
          findUpdateType(lockPkgName, collated, collated.packages[name].updateType);
        } else {
          const pkgType = _.get(collated.packages, [lockPkgName, "updateType"], 0);
          const updateType = _.max([collated.packages[name].updateType, pkgType]);
          collated.packages[lockPkgName].updateType = updateType;
        }
      }
    }
  });

  const indirectBumps = [];

  // update any package that depend on a directly bumped packages or its version locks
  let count = 0;
  do {
    count = 0;
    const dependents = Object.keys(changed.depMap);
    for (const name of dependents) {
      const pkgType = _.get(collated.packages, [name, "updateType"], 0);
      const deps = changed.depMap[name];

      const updateTypes = deps
        .filter((depName) => collated.packages[depName])
        .map((depName) => collated.packages[depName])
        .map((x) => x.updateType);
      if (updateTypes.length > 0) {
        const minBumpType = _.max([pkgType, ...updateTypes]);
        if (collated.realPackages.includes(name)) {
          if (minBumpType !== pkgType) {
            collated.packages[name].updateType = minBumpType;
            count++;
          }
        } else {
          findUpdateType(name, collated, minBumpType);
          if (!indirectBumps.includes(name)) {
            indirectBumps.push(name);
          }
        }
      }
    }
  } while (count > 0);

  // check for version locking of indirect bump packages
  const indirectLockBumps = indirectBumps.filter((pkgName) => {
    const verLocks = opts.versionLockMap[pkgName];
    if (verLocks) {
      logger.info("version locks:", pkgName, verLocks);
      for (const lockPkgName of _.without(verLocks, pkgName)) {
        if (!indirectBumps.includes(lockPkgName)) {
          findUpdateType(lockPkgName, collated, collated.packages[pkgName].updateType);
          return true;
        }
      }
    }
    return false;
  });

  indirectBumps.push(...indirectLockBumps);

  // find version from updateType for both direct and indirect bumps
  for (const [name, pkg] of Object.entries(collated.packages)) {
    findVersion(name, (pkg as any).updateType, collated);
  }

  const directBumps = collated.realPackages.filter(
    (name) => collated.packages[name] && collated.packages[name].newVersion
  );

  collated.directBumps = directBumps;
  collated.indirectBumps = indirectBumps;
  return Promise.resolve(collated);
};
