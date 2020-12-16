"use strict";

/* eslint-disable no-console */

const _ = require("lodash");

function processDirectDeps(packages) {
  const add = (name, deps) => {
    const depPkg = packages[name];

    _.each(deps, (semver, depName) => {
      if (!packages.hasOwnProperty(depName)) return;
      depPkg.localDeps.push(depName);
      packages[depName].dependents.push(name);
    });
  };

  _.each(packages, (pkg, name) => {
    add(name, pkg.dependencies);
    add(name, pkg.devDependencies);
    add(name, pkg.optionalDependencies);
  });
}

function processIndirectDeps(packages, circulars) {
  let change = 0;

  const add = (info, deps) => {
    _.each(deps, dep => {
      const depPkg = packages[dep];
      if (info.localDeps.indexOf(dep) < 0 && info.indirectDeps.indexOf(dep) < 0) {
        change++;
        info.indirectDeps.push(dep);
        depPkg.dependents.push(info.name);
      }
      if (depPkg.localDeps.indexOf(info.name) >= 0) {
        const x = [info.name, depPkg.name].sort().join(",");
        if (circulars.indexOf(x) < 0) {
          circulars.push(x);
        }
        return;
      }
      add(info, depPkg.localDeps.concat(depPkg.indirectDeps));
    });
  };

  _.each(packages, pkg => {
    add(pkg, pkg.localDeps.concat(pkg.indirectDeps));
  });

  if (change > 0) {
    processIndirectDeps(packages, circulars);
  }
}

function makePkgDeps(packages, ignores, only) {
  let circulars = [];

  processDirectDeps(packages);
  processIndirectDeps(packages, circulars);

  if (only && only.length > 0) {
    only.forEach(x => {
      if (!packages[x]) {
        console.log(`warn: package ${x} of your '--only' option does not exist`);
      }
    });
    Object.keys(packages).forEach(p => {
      if (!only.includes(p) && !ignores[p]) {
        ignores.push(p);
      }
    });
  }

  const depMap = _.mapValues(packages, pkg => {
    return _.pick(pkg, ["name", "localDeps", "indirectDeps", "dependents"]);
  });

  circulars = _.uniq(circulars).map(x => x.split(","));
  ignores = ignores.concat(
    _.map(circulars, pair => {
      const depA = packages[pair[0]].dependents.length;
      const depB = packages[pair[1]].dependents.length;
      if (depA === depB) return undefined;
      return depA > depB ? pair[1] : pair[0];
    }).filter(x => x)
  );

  return {
    packages,
    depMap,
    circulars,
    ignores
  };
}

module.exports = makePkgDeps;
