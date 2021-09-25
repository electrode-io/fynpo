import assert from "assert";
import Path from "path";
import { promises as Fs } from "fs";
import filterScanDir from "filter-scan-dir";
import mm from "minimatch";
import _ from "lodash";
import Semver from "semver";
import { groupMM, MMGroups } from "./minimatch-group";

/**
 * Basic information about a package: name, version, and its path in the monorepo
 */
export type PackageBasicInfo = {
  /** name of the package */
  name: string;
  /** version of the package */
  version: string;
  /**
   * path to package dir from monorepo top dir.
   *
   * - not full path
   * - always uses / for path separator, even on windows
   * - This serves as a unique reference to each local package.  In case the monorepo
   *   contains multiple versions of a package in different directories.
   */
  path: string;
};

/**
 * indicate which dependencies section in package.json specified a package
 *
 * - `dep` - `dependencies`
 * - `dev` - `devDependencies`
 * - `opt` - `optionalDependencies`
 * - `peer` - `peerDependencies`
 */
export type DEP_SECTIONS = "dep" | "dev" | "opt" | "peer";

/**
 * Basic referencing information of a package to remember the dependency relationship
 *
 * - It could be a package that another depends on
 * - It could be a package that depends on another
 */
export type PackageDepRef = PackageBasicInfo & {
  /**
   * section of dependencies from package.json that specified the dependency
   * - `dep`, `dev`, `opt`, `peer`
   */
  depSection: DEP_SECTIONS;
  /**
   * if the dependency was pulled by an intermediate package,
   * this list the packages that lead up to it.
   */
  indirectSteps?: string[];
};

/**
 * Information about a package within the monorepo
 */
export type FynpoPackageInfo = PackageBasicInfo & {
  /** dependencies from package.json */
  dependencies: Record<string, string>;
  /** devDependencies from package.json */
  devDependencies: Record<string, string>;
  /** optionalDependencies from package.json */
  optionalDependencies: Record<string, string>;
  /** peerDependencies from package.json */
  peerDependencies: Record<string, string>;
  private: boolean;
  /**
   * The package dir name only
   *
   * - If npm scope is part of the dir name, it will be included. like `"@scope/name"`
   */
  pkgDir: string;
  /** original raw string form of package.json loaded */
  pkgStr: string;
  /** original package.json object loaded */
  pkgJson: Record<string, unknown>;
};

/**
 * contain all the found packages in a fynpo monorepo
 */
export type FynpoPackages = {
  /** The packages referenced by the name as key */
  byName: Record<string, FynpoPackageInfo[]>;
  /** The packages referenced by their path from monorepo top directory */
  byPath: Record<string, FynpoPackageInfo>;
  /** The packages referenced by their ID (`name@version`)  */
  byId: Record<string, FynpoPackageInfo>;
};

/**
 *
 */
export type FynpoTopoPackages = {
  sorted: PackageDepData[];
  circulars: PackageDepData[];
};

/**
 * Contain the dependencies resolution data for a package
 */
export type PackageDepData = {
  /** the package info */
  pkgInfo: FynpoPackageInfo;
  /** all local dependencies by path */
  localDepsByPath: Record<string, PackageDepRef>;
  /** all local dependents by path */
  dependentsByPath: Record<string, PackageDepRef>;
  /** path of circular dependencies */
  pathOfCirculars?: string[];
};

export type ReadFynpoOptions = {
  /** minimatch pattern to match packages in the monorepo */
  patterns?: string[];
  /** top dir of the monorepo to start searching */
  cwd?: string;
};

/**
 * Create a package ID by joining name and version into a single string with `@`
 *
 * @param name package name
 * @param version package version
 * @returns
 */
export function pkgId(name: string, version?: string) {
  /* istanbul ignore next */
  const ver = version ? `@${version}` : "";
  return `${name}${ver}`;
}

/**
 * Resolve a package from multiple versions by a semver
 *
 * If there's only one version or no version satisfies the semver, then returns the
 * first version in the array.
 *
 * @param semver semver string
 * @param packages array of package info
 * @returns package info
 */
function resolvePackage(semver: string, packages: FynpoPackageInfo[]): FynpoPackageInfo {
  return (
    (packages.length > 1 && packages.find((pkg) => Semver.satisfies(pkg.version, semver))) ||
    packages[0]
  );
}

/**
 * Make a package ID from basic info by joining name and version into a single string.
 *
 * @param info package basic info
 * @returns
 */
export function pkgInfoId(info: PackageBasicInfo) {
  return pkgId(info.name, info.version);
}

/**
 * fynpo dep graph manager
 */
export class FynpoDepGraph {
  packages: FynpoPackages;
  depMapByPath: Record<string, PackageDepData>;
  /** Remember resolved package for a `name@<semver>` ID to its `name@version` ID */
  resolvedCache: Record<string, string>;
  _options: ReadFynpoOptions;

  constructor(
    options: ReadFynpoOptions = {
      patterns: ["packages/*"],
      cwd: process.cwd(),
    }
  ) {
    this._options = options;
    this.depMapByPath = {};
    this.resolvedCache = {};
  }

  async resolve() {
    if (!this.packages) {
      await this.readPackages();
    }
    this.resolveDirectDeps();
    this.resolveIndirectDeps();
  }

  /**
   * Return array of dep data sorted by dependency topological order
   *
   * @returns array of paths of package dep data
   */
  getTopoSortPackagePaths() {
    type DepCount = {
      depData: PackageDepData;
      count: number;
    };

    const depRecords: Record<string, DepCount> = {};
    const changed = [];

    for (const path in this.depMapByPath) {
      const depData = this.depMapByPath[path];
      const count = Object.keys(depData.localDepsByPath).length;
      depRecords[path] = {
        depData,
        count,
      };
      // There must be at least 1 package without any dependency, else there's a circular
      if (count === 0) {
        changed.push(path);
      }
    }

    const sorted = [];

    while (changed.length > 0) {
      const record = depRecords[changed.pop()];
      if (record.count === 0) {
        record.count = -1;
        sorted.push(record.depData.pkgInfo.path);
        for (const path in record.depData.dependentsByPath) {
          const record2 = depRecords[path];
          /* istanbul ignore else */
          if (record2.count > 0) {
            record2.count--;
            if (record2.count === 0) {
              changed.push(path);
            }
          }
        }
      }
    }

    return {
      sorted,
      circulars: Object.keys(depRecords).filter((path) => depRecords[path].count > 0),
    };
  }

  /**
   * Return array of dep data sorted by dependency topological order
   *
   * @returns array of sorted package dep data
   */
  getTopoSortPackages(): FynpoTopoPackages {
    const topo = this.getTopoSortPackagePaths();
    return {
      sorted: topo.sorted.map((p) => this.depMapByPath[p]),
      circulars: topo.circulars.map((p) => this.depMapByPath[p]),
    };
  }

  /**
   * Read the packages of a fynpo monorepo.
   *
   * - if `patterns` is empty, then look for all `package.json` files, except the top level one.
   *
   * @returns - packages from the fynpo mono-repo
   */
  async readPackages(): Promise<FynpoPackages> {
    const { patterns, cwd } = this._options;
    let groups: MMGroups;

    if (_.isEmpty(patterns)) {
      groups = { ".": null };
    } else {
      const mms = patterns.map((p) => new mm.Minimatch(p));
      groups = groupMM(mms, {});
    }

    const files: string[] = [];
    for (const prefix in groups) {
      const scanned = await filterScanDir({
        cwd,
        prefix,
        filter: (file: string, path: string) => {
          return path !== "." && file === "package.json";
        },
        filterDir: (dir: string, _p: string, extras: any) => {
          if (dir !== "node_modules") {
            return prefix === "." && groups[prefix] === null
              ? !dir.startsWith(".")
              : groups[prefix].find((save) => save.mm.match(extras.dirFile));
          }
          return false;
        },
      });

      files.push(scanned);
    }

    const allFiles: string[] = [].concat(...files);

    const byName: Record<string, FynpoPackageInfo[]> = {};

    // Read each package.json and generate PackageInfo for it
    for (const pkgFile of allFiles) {
      const pkgStr = await Fs.readFile(Path.join(cwd, pkgFile), "utf-8");
      const pkgJson = JSON.parse(pkgStr);

      if (pkgJson.fynpo === false) {
        continue;
      }

      const path = Path.dirname(pkgFile);

      assert(pkgJson.name, `package at ${pkgFile} doesn't have name`);

      // check for npm scope
      const pkgDir: string =
        pkgJson.name[0] === "@" && (path.endsWith(`/${pkgJson.name}`) || path === pkgJson.name)
          ? pkgJson.name
          : Path.basename(path);

      const pkgInfo: FynpoPackageInfo = {
        name: pkgJson.name,
        version: pkgJson.version,
        path,
        pkgDir,
        ..._.pick(pkgJson, [
          "private",
          "dependencies",
          "devDependencies",
          "optionalDependencies",
          "peerDependencies",
        ]),
        pkgStr,
        pkgJson,
      };

      // hide the original raw data
      Object.defineProperties(pkgInfo, {
        pkgStr: { enumerable: false },
        pkgJson: { enumerable: false },
      });

      if (byName.hasOwnProperty(pkgJson.name)) {
        byName[pkgJson.name].push(pkgInfo);
      } else {
        byName[pkgJson.name] = [pkgInfo];
      }
    }

    let byPath: Record<string, FynpoPackageInfo> = {};
    let byId: Record<string, FynpoPackageInfo> = {};

    // create package map byPath and byId
    for (const name in byName) {
      byName[name].forEach((pkg) => {
        byPath[pkg.path] = pkg;
        byId[`${pkg.name}@${pkg.version}`] = pkg;
      });
      // sort package with multiple versions from latest to oldest
      if (byName[name].length > 1) {
        byName[name].sort((a, b) => Semver.compare(b.version, a.version));
      }
    }

    return (this.packages = { byName, byPath, byId });
  }

  /**
   * Figure out all the packages' direct dependencies on other local packages
   *
   */
  private resolveDirectDeps() {
    const { byId, byName, byPath } = this.packages;
    const depMapByPath = this.depMapByPath;

    const doResolve = (
      depData: PackageDepData,
      deps: Record<string, string>,
      section: DEP_SECTIONS
    ) => {
      const { pkgInfo } = depData;

      _.each(deps, (semver: string, name: string) => {
        // dep is not a local package in the monorepo, nothing to do
        /* istanbul ignore if */
        if (!byName[name]) {
          return;
        }

        const semId = pkgId(name, semver);
        const resolveId = this.resolvedCache[semId];
        const depPkg = (resolveId && byId[resolveId]) || resolvePackage(semver, byName[name]);

        if (!resolveId) {
          this.resolvedCache[semId] = pkgInfoId(depPkg);
        }

        this.addDep(pkgInfo, depPkg, section);
      });
    };

    for (const path in byPath) {
      depMapByPath[path] = {
        pkgInfo: byPath[path],
        localDepsByPath: {},
        dependentsByPath: {},
      };
    }

    for (const id in byId) {
      const pkgInfo = byId[id];
      const depData = depMapByPath[pkgInfo.path];
      doResolve(depData, pkgInfo.dependencies, "dep");
      doResolve(depData, pkgInfo.devDependencies, "dev");
      doResolve(depData, pkgInfo.optionalDependencies, "opt");
    }
  }

  /**
   * Add a dependency relation by package paths
   *
   * @param from - path of package depend from
   * @param to - path of package to depend on
   * @param depSection - section in package.json
   * @param indirectSteps - intermediate dep steps
   */
  addDepByPath(from: string, to: string, depSection: DEP_SECTIONS, indirectSteps?: string[]) {
    const fromPkg = this.packages.byPath[from];
    const toPkg = this.packages.byPath[to];
    if (fromPkg && toPkg) {
      this.addDep(fromPkg, toPkg, depSection, indirectSteps);
    }
  }

  /**
   * Add a dependency relation by package IDs
   *
   * @param from - id of package depend from
   * @param to - id of package to depend on
   * @param depSection - section in package.json
   * @param indirectSteps - intermediate dep steps
   */
  addDepById(from: string, to: string, depSection: DEP_SECTIONS, indirectSteps?: string[]) {
    const fromPkg = this.packages.byId[from];
    const depPkg = this.packages.byId[to];
    if (fromPkg && depPkg) {
      this.addDep(fromPkg, depPkg, depSection, indirectSteps);
    }
  }

  /**
   * check and update any circular dependency between packages
   *
   * @param pkgInfo package that depends on
   * @param depPkg package to depend on
   * @returns true if circular else false
   */
  checkCircular(pkgInfo: FynpoPackageInfo, depPkg: FynpoPackageInfo) {
    const dataPkg = this.depMapByPath[pkgInfo.path];
    const dataDep = this.depMapByPath[depPkg.path];

    // check circular
    if (dataDep.localDepsByPath.hasOwnProperty(pkgInfo.path)) {
      // remember circular package's path
      if (!dataPkg.pathOfCirculars) {
        dataPkg.pathOfCirculars = [];
      }

      if (!dataPkg.pathOfCirculars.includes(depPkg.path)) {
        dataPkg.pathOfCirculars.push(depPkg.path);
      }
      return true;
    }

    return !_.isEmpty(dataDep.pathOfCirculars);
  }

  /**
   * Add a dependency relation
   *
   * @param pkgInfo package that depends on another
   * @param depPkg package to depend on
   * @param depSection section in package.json
   * @param indirectSteps intermediate dep steps
   *
   */
  addDep(
    pkgInfo: FynpoPackageInfo,
    depPkg: FynpoPackageInfo,
    depSection: DEP_SECTIONS,
    indirectSteps?: string[]
  ) {
    const dataPkg = this.depMapByPath[pkgInfo.path];
    const dataDep = this.depMapByPath[depPkg.path];

    dataPkg.localDepsByPath[depPkg.path] = {
      name: depPkg.name,
      version: depPkg.version,
      path: depPkg.path,
      depSection,
    };

    dataDep.dependentsByPath[pkgInfo.path] = {
      name: pkgInfo.name,
      version: pkgInfo.version,
      path: pkgInfo.path,
      depSection,
    };

    if (indirectSteps) {
      dataPkg.localDepsByPath[depPkg.path].indirectSteps = indirectSteps;
      dataDep.dependentsByPath[pkgInfo.path].indirectSteps = indirectSteps;
    }

    this.checkCircular(pkgInfo, depPkg);
  }

  /**
   * Figure out all the packages' indirect dependencies on other local packages
   *
   */
  private resolveIndirectDeps(nestedLevel = 0) {
    const { byPath } = this.packages;
    const depMapByPath = this.depMapByPath;
    let change = 0;

    const doResolve = (
      dataPkg: PackageDepData,
      localDeps: Record<string, PackageDepRef>,
      steps: string[],
      section?: DEP_SECTIONS
    ) => {
      const { pkgInfo } = dataPkg;
      // go through all found deps
      _.each(localDeps, (depRef: PackageDepRef) => {
        const sec = section || depRef.depSection;
        const depId = pkgInfoId(depRef);
        const depInfo = byPath[depRef.path];
        const dataDep = depMapByPath[depRef.path];
        // check circular
        if (this.checkCircular(pkgInfo, depInfo)) {
          return;
        }

        const stepsCopy = [].concat(steps);
        if (stepsCopy.length === 1) {
          stepsCopy[0] = `${stepsCopy[0]}(${depRef.depSection})`;
        }

        // check if pkg is already part of localDeps
        if (!dataPkg.localDepsByPath.hasOwnProperty(depInfo.path)) {
          change++;
          this.addDep(pkgInfo, depInfo, sec, stepsCopy);
        }

        // resolve further with deps of depPkg
        doResolve(
          dataPkg,
          dataDep.localDepsByPath,
          stepsCopy.concat(`${depId}(${depRef.depSection})`),
          sec
        );
      });
    };

    for (const path in depMapByPath) {
      const depData = depMapByPath[path];
      doResolve(depData, depData.localDepsByPath, [pkgInfoId(depData.pkgInfo)]);
    }

    if (change > 0) {
      assert(
        nestedLevel < 50,
        "FynpoDepGraph.resolveIndirectDeps nested too deep - there may be circular deps that's not detected"
      );
      this.resolveIndirectDeps(nestedLevel + 1);
    }
  }
}
