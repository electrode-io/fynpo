import assert from "assert";
import Path from "path";
import { promises as Fs } from "fs";
import { filterScanDir } from "filter-scan-dir";
import mm from "minimatch";
import _ from "lodash";
import Semver from "semver";
import { groupMM, MMGroups } from "./minimatch-group";
import { posixify } from "./util";
import isPathInside from "is-path-inside";

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

const DepSectionMap = {
  dependencies: "dep",
  devDependencies: "dev",
  optionalDependencies: "opt",
  peerDependencies: "peer",
  dep: "dep",
  dev: "dev",
  opt: "opt",
  peer: "peer",
};

/**
 * get the dep section from package.json dep sections
 *
 * @param fullName - full name from package.json dep section
 * @returns dep section
 */
export function getDepSection(fullName: string): DEP_SECTIONS {
  return DepSectionMap[fullName] || "dep";
}

/**
 * make a indirect dep step string
 *
 * @param name package name
 * @param version package version
 * @param sec section it's specified as a dep package
 * @returns step string
 */
export function makeDepStep(name: string, version: string, sec: string) {
  return `${pkgId(name, version)}(${sec})`;
}

/**
 * refer to a package by `id`, `path`, or `name`
 */
type PackageRefType = "id" | "path" | "name";

/**
 * Reference to a package by id, path, or name.
 *
 * Supports RegExp or minimatch (for path)
 */
export class PackageRef {
  /** value's reference type, `id`, `path`, or `name` */
  type: PackageRefType;
  /** value that reference the package */
  value: string;
  /**
   * If value reference is a regexp (starts with / and has a closing /), then
   * create a RegExp from it.
   */
  regex?: RegExp;
  mm?: mm.IMinimatch;

  constructor(ref: string) {
    this.parseRef(ref);
  }

  /**
   * Parse a package ref in string form
   *
   * The reference type can be a package id, name, or path.
   *
   * - user can specify type with `id:`, `name:` or `path:`
   * - if no type but there's a `@` in the middle then it's `id`
   *   else default to `name`
   *
   * @param ref package string reference
   */
  parseRef(ref: string): void {
    const parts = ref.split(":");

    if (parts.length > 1) {
      const tmp = parts[0].trim();
      if (tmp === "id" || tmp === "path" || tmp === "name") {
        this.type = tmp;
      } else {
        throw new Error(
          `package ref '${ref}' has unknown type '${tmp}' - must be 'id', 'path', or 'name'`
        );
      }
      this.value = parts[1].trim();
    } else {
      this.value = parts[0].trim();
      if (this.value.lastIndexOf("@") > 0) {
        this.type = "id";
      } else {
        this.type = "name";
      }
    }

    if (this.value[0] === "/") {
      const endIx = this.value.lastIndexOf("/");
      if (endIx > 1) {
        const regExpStr = this.value.substring(1, endIx);
        const flagStr = this.value.substring(endIx + 1);
        this.regex = new RegExp(regExpStr, flagStr);
      }
    } else if (this.type === "path") {
      this.mm = new mm.Minimatch(this.value);
    }
  }

  match(pkgInfo: PackageBasicInfo): boolean {
    if (this.type === "path") {
      return this.regex ? this.regex.exec(pkgInfo.path) !== null : this.mm.match(pkgInfo.path);
    } else if (this.type === "id") {
      return this.regex
        ? this.regex.exec(pkgInfoId(pkgInfo)) !== null
        : this.value === pkgInfoId(pkgInfo);
    } else {
      return this.regex ? this.regex.exec(pkgInfo.name) !== null : this.value === pkgInfo.name;
    }
  }
}

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
 * Specify a dependency relation between two packages
 */
export type PackageDepRelation = {
  /** the package dependency is from */
  fromPkg: PackageBasicInfo;
  /** the package dependency is on */
  onPkg: PackageBasicInfo;
  /** package.json section */
  depSection: DEP_SECTIONS;
  /** If not a direct dep, then the list of packages in between */
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
function resolvePackage(
  semver: string,
  packages: FynpoPackageInfo[],
  fallbackToFirst = true
): FynpoPackageInfo {
  const found = packages.find((pkg) => Semver.satisfies(pkg.version, semver));
  if (found) {
    return found;
  }

  if (fallbackToFirst) {
    return packages[0];
  }

  return undefined;
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

  constructor(options: ReadFynpoOptions = {}) {
    this._options = { cwd: process.cwd(), ...options };
    this.depMapByPath = {};
    this.resolvedCache = {};
    this.packages = {
      byId: {},
      byName: {},
      byPath: {},
    };
  }

  /**
   * resolve packages from fynpo
   */
  async resolve() {
    if (_.isEmpty(this.packages.byName)) {
      await this.readPackages();
    }
    this.updateDepMap();
  }

  /**
   * update package depdencies map
   * - re-entrant safe
   */
  updateDepMap() {
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
      /* istanbul ignore else */
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

    // no patterns => setup to search for all package.json
    const autoSearch: boolean = _.isEmpty(patterns);
    const autoSearchFound: string[] = [];
    if (autoSearch) {
      groups = { ".": null };
    } else {
      const mms = patterns.map((p) => new mm.Minimatch(p));
      groups = groupMM(mms, {});
    }

    const foundInAutoSearch = (path: string) => {
      if (!autoSearch) {
        return false;
      }
      for (const e of autoSearchFound) {
        if (isPathInside(path, e)) {
          return true;
        }
      }
      return false;
    };

    const files: string[][] = [];
    for (const prefix in groups) {
      const scanned = await filterScanDir({
        cwd,
        prefix,
        concurrency: 500,
        filter: (file: string, path: string) => {
          if (path && path !== "." && file === "package.json") {
            if (foundInAutoSearch(path)) {
              //
              // In auto search, if we've found a package.json in a dir, we don't want to
              // search any other package.json further under that dir
              //
              return false;
            }
            autoSearchFound.push(path);
            return true;
          }
          return false;
        },
        filterDir: (dir: string, path: string, extras: any) => {
          if (dir !== "node_modules") {
            if (foundInAutoSearch(path)) {
              return false;
            }
            return prefix === "." && groups[prefix] === null
              ? !dir.startsWith(".")
              : Boolean(groups[prefix].find((save) => save.mm.match(extras.dirFile)));
          }
          return false;
        },
      });

      files.push(scanned);
    }

    const allFiles: string[] = [].concat(...files).sort();

    // Read each package.json and generate PackageInfo for it
    for (const pkgFile of allFiles) {
      await this.addPackageByFile(pkgFile);
    }

    this.updateAuxPackageData();

    return this.packages;
  }

  /**
   * Add a package to the graph by the path to its package.json file
   *
   * @param pkgFile - path to the package.json file
   */
  async addPackageByFile(pkgFile: string) {
    const pkgStr = await Fs.readFile(Path.join(this._options.cwd, pkgFile), "utf-8");
    const pkgJson = JSON.parse(pkgStr);
    this.addPackage(pkgJson, Path.dirname(pkgFile), pkgStr);
  }

  /**
   * Add a package to the graph using the data from its package.json
   *
   * @param pkgJson - data from package.json
   * @param pkgPath - relative path from the top dir of fynpo to the package.  **It must use `/` only.**
   * @param pkgStr - string form of package.json
   * @returns
   */
  addPackage(pkgJson: Record<string, any>, pkgPath: string, pkgStr?: string) {
    if (pkgJson.fynpo === false) {
      return;
    }

    assert(pkgJson.name, `package at ${pkgPath} doesn't have name`);

    // check for npm scope
    const pkgDir: string =
      pkgJson.name[0] === "@" && (pkgPath.endsWith(`/${pkgJson.name}`) || pkgPath === pkgJson.name)
        ? pkgJson.name
        : Path.basename(pkgPath);

    const pkgInfo: FynpoPackageInfo = {
      name: pkgJson.name,
      version: pkgJson.version,
      path: pkgPath,
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

    const { byName } = this.packages;

    if (byName.hasOwnProperty(pkgJson.name)) {
      byName[pkgJson.name].push(pkgInfo);
    } else {
      byName[pkgJson.name] = [pkgInfo];
    }
  }

  /**
   * update auxiliary package data
   *
   * - (re)generate `byId` map
   * - (re)generate `byPath` map
   * - sort multiple versions from latest to oldest in `byName`
   */
  updateAuxPackageData() {
    this.packages.byId = {};
    this.packages.byPath = {};
    const { byName, byPath, byId } = this.packages;

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
  }

  /**
   * Resolve a package by its name and semver against the fynpo packages
   *
   * @param name - package name
   * @param semver - semver
   * @param fallbackToFirst - should use the first entry if semver didn't match any version
   * @returns fynpo package info
   */
  resolvePackage(name: string, semver: string, fallbackToFirst = true): FynpoPackageInfo {
    if (this.packages.byName[name]) {
      return resolvePackage(semver, this.packages.byName[name], fallbackToFirst);
    }
    return undefined;
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
      if (!depMapByPath[path]) {
        depMapByPath[path] = {
          pkgInfo: byPath[path],
          localDepsByPath: {},
          dependentsByPath: {},
        };
      }
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
   * Add depdencies from a list of dep relations
   *
   * @param relations - relations
   */
  addDepRelations(relations: PackageDepRelation[]) {
    relations.forEach((rel) => {
      this.addDepByPath(rel.fromPkg.path, rel.onPkg.path, rel.depSection, rel.indirectSteps);
    });
  }

  /**
   * Add a dependency relation
   *
   * @param pkgInfo package that depends on another
   * @param depPkg package to depend on
   * @param depSection section in package.json
   * @param indirectSteps intermediate dep steps
   *
   * @returns boolean - whether dep is added (it's not if it already exist)
   */
  addDep(
    pkgInfo: FynpoPackageInfo,
    depPkg: FynpoPackageInfo,
    depSection: DEP_SECTIONS,
    indirectSteps?: string[]
  ) {
    const dataPkg = this.depMapByPath[pkgInfo.path];
    const dataDep = this.depMapByPath[depPkg.path];

    if (dataPkg.localDepsByPath[depPkg.path]) {
      // dep relation already exist
      return false;
    }

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

    return true;
  }

  /**
   * Get a package at a directory
   *
   * @param dir - directory of package to get
   */
  getPackageAtDir(dir: string): FynpoPackageInfo {
    const path = posixify(Path.isAbsolute(dir) ? Path.relative(this._options.cwd, dir) : dir);
    return this.packages.byPath[path];
  }

  /**
   * Get a package by its name
   * @param name - name of package
   * @returns
   */
  getPackageByName(name: string): FynpoPackageInfo {
    return _.first(this.packages.byName[name]);
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
          stepsCopy.concat(makeDepStep(depRef.name, depRef.version, depRef.depSection)),
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
