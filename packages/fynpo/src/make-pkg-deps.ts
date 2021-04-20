/* eslint-disable no-console */

import _ from "lodash";
import logger from "./logger";

const globalCmnds = ["bootstrap", "local", "run"];

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

function includeDeps(packages, level) {
  const localDeps = _.uniq(
    Object.keys(packages).reduce((acc, p) => {
      if (packages[p] && !packages[p].ignore) {
        return acc.concat(
          packages[p].localDeps.filter(x => packages[x] && packages[x].ignore)
        );
      }
      return acc;
    }, [])
  );
  if (localDeps.length > 0) {
    localDeps.forEach(p => {
      if (packages[p]) {
        packages[p].ignore = false;
      }
    });
    level--;
    if (level > 0) {
      includeDeps(packages, level);
    }
  }
}

function makePkgDeps(packages, opts, cmdName = "") {
  const cwd = opts.cwd || process.cwd();
  let circulars = [];
  let ignores = opts.ignore || [];

  processDirectDeps(packages);
  processIndirectDeps(packages, circulars);

  for (const p in packages) {
    const pkg = packages[p];
    if (cwd === pkg.path) {
      if (!globalCmnds.includes(cmdName)) {
        logger.error(`${cmdName} command is only supported at project root level.`);
        process.exit(1);
      }
      opts.only = [p];
      break;
    }
  }

  if (opts.scope && opts.scope.length > 0) {
    Object.keys(packages).forEach((p) => {
      const scope = p[0] === "@" ? p.slice(0, p.indexOf("/")) : undefined;
      if ((!scope || !opts.scope.includes(scope)) && !ignores[p]) {
        ignores.push(p);
      }
    });
  }

  if (opts.only && opts.only.length > 0) {
    opts.only.forEach(x => {
      if (!packages[x]) {
        console.log(`warn: package ${x} of your '--only' option does not exist`);
      }
    });
    Object.keys(packages).forEach(p => {
      if (!opts.only.includes(p) && !ignores[p]) {
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

  ignores.forEach(x => {
    if (packages[x]) {
      packages[x].ignore = true;
    } else {
      logger.warn("Ignore package", x, "does not exist");
    }
  });

  if (opts.deps > 0) {
    includeDeps(packages, opts.deps);
  }

  return {
    packages,
    depMap,
    circulars
  };
}

export = makePkgDeps;
