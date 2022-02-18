import Fs from "fs";
const pFs = Fs.promises;
import Path from "path";
import { logger } from "./logger";
import _ from "lodash";
import { cosmiconfigSync } from "cosmiconfig";
import shcmd from "shcmd";
import _optionalRequire from "optional-require";
import { FynpoDepGraph, PackageInfo, PackageRef } from "@fynpo/base";
import os from "os";
import { startMetaMemoizer } from "./meta-memoizer";

export const defaultTagTemplate = `fynpo-rel-{YYYY}{MM}{DD}-{COMMIT}`;

const xrequire = eval("require"); // eslint-disable-line

const optionalRequire = _optionalRequire(xrequire);

/**
 * Make a publish tag from template
 * - template is a string with special tokens in `{}`
 * - `{DD}` - two digit date
 * - `{MM}` - two digit month
 * - `{YYYY}` - four digit year
 * - `{COMMIT}` - first 8 chars from git commit hash
 * - `{hh}` - two digit hour in 24 format
 * - `{mm}` - two digit minute
 * - `{ss}` - two digit second
 *
 * @param tmpl publish tag template
 */
export function makePublishTag(tmpl: string, { date = undefined, gitHash = "" } = {}): string {
  const d = date || new Date();
  const replacers = {
    "{DD}": _.padStart(`${d.getDate()}`, 2, "0"),
    "{MM}": _.padStart(`${d.getMonth() + 1}`, 2, "0"),
    "{YYYY}": _.padStart(`${d.getFullYear()}`, 4, "0"),
    "{COMMIT}": gitHash.substr(0, 8),
    "{hh}": `${d.getHours()}`.padStart(2, "0"),
    "{mm}": `${d.getMinutes()}`.padStart(2, "0"),
    "{ss}": `${d.getSeconds()}`.padStart(2, "0"),
  };

  const newTag = (tmpl || defaultTagTemplate).replace(/{[^}]+}/g, (token) => {
    if (replacers[token]) {
      return replacers[token];
    }
    const valid = Object.keys(replacers).join(", ");
    throw new Error(
      `unknown token '${token}' in command.publish.gitTagTemplate - valid tokens are: ${valid}`
    );
  });

  return newTag;
}

/**
 * Make a git tag search term from the publish tag template
 *
 * @param tmpl
 * @returns
 */
export function makePublishTagSearchTerm(tmpl: string): string {
  return (tmpl || defaultTagTemplate).replace(/{[^}]+}/g, "*").replace(/\*+/g, "*");
}

/* eslint-disable complexity */

export const locateGlobalNodeModules = async () => {
  //
  const nodeBinDir = Path.dirname(process.argv[0]);
  const nm = "node_modules";

  // 1. check ./node_modules (windows)
  // 2. check ../node_modules
  // 3. check ../lib/node_modules (unix)

  const checks = ["", "..", ["..", "lib"]];

  for (const chk of checks) {
    const dir = Path.join(...[nodeBinDir].concat(chk, nm));
    try {
      const stat = await pFs.stat(dir);
      if (stat.isDirectory()) {
        return dir;
      }
    } catch (e) {
      //
    }
  }

  return "";
};

export const locateGlobalFyn = async (globalNmDir = null) => {
  globalNmDir = globalNmDir || (await locateGlobalNodeModules());

  if (!globalNmDir) {
    logger.error("Unable to locate your global node_modules from", process.argv[0]);
    return {};
  }

  try {
    const dir = Path.join(globalNmDir, "fyn");
    /* eslint-disable @typescript-eslint/no-var-requires */
    const pkgJson = xrequire(Path.join(dir, "package.json"));
    return {
      dir,
      pkgJson,
    };
  } catch (e) {
    return {};
  }
};

export const loadFynpoConfig = (cwd: string = process.cwd(), configPath?: string) => {
  const explorer = cosmiconfigSync("fynpo", {
    searchPlaces: ["fynpo.config.js", "fynpo.json", "lerna.json"],
  });
  const explicitPath = configPath ? Path.resolve(cwd, configPath) : undefined;
  const explore = explicitPath ? explorer.load : explorer.search;
  const searchPath = explicitPath ? explicitPath : cwd;
  const config = explore(searchPath);

  return config ? config : null;
};

export const loadConfig = (cwd = process.cwd(), commitlint = false) => {
  let fynpoRc: any = {};
  let dir = cwd;
  let fileName = "";

  const data = loadFynpoConfig(cwd);

  if (data && !data.isEmpty) {
    fileName = data.filepath ? Path.basename(data.filepath) : "";
    dir = data.filepath ? Path.dirname(data.filepath) : cwd;
    if (fileName === "lerna.json" && !data.config.fynpo) {
      logger.info("found lerna.json at", dir, "adding fynpo signature");
      fynpoRc = { ...data.config, fynpo: true };
      Fs.writeFileSync(Path.join(dir, "lerna.json"), JSON.stringify(fynpoRc, null, 2) + "\n");
    } else {
      fynpoRc = data.config;
    }
  } else {
    fileName = commitlint ? "fynpo.config.js" : "fynpo.json";
    dir = cwd;

    logger.info(`creating ${fileName} at ${cwd}.`);
    const dest = Path.join(cwd, fileName);

    if (commitlint) {
      const srcTmplDir = Path.join(__dirname, "../templates");
      const src = Path.join(srcTmplDir, fileName);
      if (Fs.existsSync(src)) {
        shcmd.cp(src, dest);
        fynpoRc = optionalRequire(src) || {};
      }
    } else {
      fynpoRc = {
        changeLogMarkers: ["## Packages", "## Commits"],
        command: { publish: { tags: {}, versionTagging: {} } },
      };
      Fs.writeFileSync(dest, `${JSON.stringify(fynpoRc, null, 2)}\n`);
    }
  }

  // add alias patterns for packages config
  if (fynpoRc.hasOwnProperty("packages")) {
    fynpoRc.patterns = fynpoRc.packages;
  }

  return { fynpoRc, dir, fileName };
};

export const getRootScripts = (cwd = process.cwd()) => {
  const config = JSON.parse(Fs.readFileSync(Path.join(cwd, "package.json")).toString());
  return config.scripts || {};
};

export const generateLintConfig = () => {
  const config = {
    /*
     * Resolve and load @commitlint/config-conventional from node_modules.
     * Referenced packages must be installed
     */
    extends: ["@commitlint/config-conventional"],
    /*
     * Parser preset configuration
     */
    parserPreset: {
      parserOpts: {
        headerPattern: /^\[([^\]]+)\] ?(\[[^\]]+\])? +(.+)$/,
        headerCorrespondence: ["type", "scope", "subject"],
      },
    },
    /*
     * Any rules defined here will override rules from @commitlint/config-conventional
     */
    rules: {
      "type-enum": [2, "always", ["patch", "minor", "major", "chore"]],
    },
    /*
     * Functions that return true if commitlint should ignore the given message.
     */
    ignores: [(commit) => commit.startsWith("[Publish]") || commit.includes("Update changelog")],
    /*
     * Whether commitlint uses the default ignore rules.
     */
    defaultIgnores: true,
    /*
     * Custom URL to show upon failure
     */
    helpUrl: "https://github.com/conventional-changelog/commitlint/#what-is-commitlint",
  };

  return { ...config };
};

export const timer = () => {
  const startTime = Date.now();
  return () => Date.now() - startTime;
};

const mergeOpts = (options) => {
  options = _.extend(
    {
      headerPattern: /^\[([^\]]+)\] ?(\[[^\]]+\])? +(.+)$/,
      headerCorrespondence: ["type", "scope", "subject"],
    },
    options
  );

  if (typeof options.headerPattern === "string") {
    options.headerPattern = new RegExp(options.headerPattern);
  }

  if (typeof options.headerCorrespondence === "string") {
    options.headerCorrespondence = options.headerCorrespondence.split(",");
  }

  return options;
};

export const lintParser = (commit, options) => {
  options = mergeOpts(options);

  if (!commit || !commit.trim()) {
    logger.error("Commit message empty");
    return {};
  }
  const headerCorrespondence = _.map(options.headerCorrespondence, (part) => part.trim());
  const headerMatch = commit.match(options.headerPattern);
  const header = {};

  if (headerMatch) {
    _.forEach(headerCorrespondence, (partName, index) => {
      const partValue = headerMatch[index + 1] || null;
      header[partName] = partValue;
    });
  } else {
    _.forEach(headerCorrespondence, function (partName) {
      header[partName] = null;
    });
  }

  return header;
};

/**
 * match versionLocks config to packages and generate the
 * mapping of locked packages.
 *
 * @param versionLocks - version locks config
 * @param graph - packages dep graph
 * @param byField - generate lock mapping by field, `name`, `id`, or `path`
 *
 * @returns version lock map
 */
export function makeVersionLockMap(
  versionLocks: string[][],
  graph: FynpoDepGraph,
  byField = "name"
): Record<string, string[]> {
  return versionLocks.reduce((mapping, locks) => {
    const lockRef = locks.map((ref: string) => new PackageRef(ref));

    const foundLocks = [];
    _.each(graph.packages.byId, (pkgInfo: PackageInfo, _id: string) => {
      const matched = lockRef.find((pkgRef) => pkgRef.match(pkgInfo));
      if (matched) {
        if (mapping[pkgInfo.path]) {
          logger.error(`package ${pkgInfo.name} at ${pkgInfo.path} version is already locked`);
        } else {
          mapping[pkgInfo[byField]] = foundLocks;
          foundLocks.push(pkgInfo[byField]);
        }
      }
    });
    return mapping;
  }, {});
}

let fynExecutable: string;

/**
 * Get path to fyn's executable file
 *
 * @returns
 */
export function getFynExecutable() {
  if (fynExecutable) {
    return fynExecutable;
  }
  fynExecutable = xrequire.resolve("fyn");

  const nodeDir = process.argv[0].replace(os.homedir(), "~");
  const fynDir = `.${Path.sep}${Path.relative(process.cwd(), fynExecutable)}`;

  logger.info(`Executing fyn with '${nodeDir} ${fynDir}'`);

  return fynExecutable;
}

let warnGlobalFynVersion = false;

/**
 * Check and warn if global fyn's version is different from fynpo's fyn version.
 */
export async function checkGlobalFynVersion() {
  if (warnGlobalFynVersion) {
    return;
  }
  warnGlobalFynVersion = true;
  getFynExecutable();

  /* eslint-disable @typescript-eslint/no-var-requires */
  const fynPkgJson = xrequire("fyn/package.json");

  const globalFynInfo = await locateGlobalFyn();
  if (globalFynInfo.dir) {
    if (globalFynInfo.pkgJson.version !== fynPkgJson.version) {
      logger.warn(
        `You have fyn installed globally but its version ${globalFynInfo.pkgJson.version} \
is different from fynpo's internal version ${fynPkgJson.version}`
      );
    }
  }
}

let metaMemoizerOpts: string;

/**
 * Start the server for multiple fyn process to memoize and share package meta info
 * during the same fynpo bootstrap session.
 *
 * @returns
 */
export async function startFynMetaMemoizer() {
  if (metaMemoizerOpts !== undefined) {
    return metaMemoizerOpts;
  }
  metaMemoizerOpts = "";

  try {
    const metaMemoizer = await startMetaMemoizer();
    metaMemoizerOpts = `--meta-mem=http://localhost:${metaMemoizer.info.port}`;
  } catch (err) {
    //
  }

  return metaMemoizerOpts;
}
