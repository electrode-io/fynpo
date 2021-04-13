import Fs from "fs";
const pFs = Fs.promises;
import Path from "path";
import logger from "./logger";
import _ from "lodash";
import { cosmiconfigSync } from "cosmiconfig";

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
    const pkgJson = require(Path.join(dir, "package.json"));
    return {
      dir,
      pkgJson,
    };
  } catch (e) {
    return {};
  }
};

export const _searchForFynpo = (cwd = process.cwd()) => {
  let dir = cwd;
  let prevDir = dir;
  let config;
  let lerna;
  let lernaDir;
  let count = 0;

  do {
    try {
      config = JSON.parse(Fs.readFileSync(Path.join(dir, "fynpo.json")).toString());
      break;
    } catch (e) {
      // Error
    }

    try {
      lerna = JSON.parse(Fs.readFileSync(Path.join(dir, "lerna.json")).toString());
      lernaDir = dir;
      if (lerna.fynpo) {
        config = lerna;
        break;
      }
    } catch (e) {
      // Error
    }

    prevDir = dir;
    dir = Path.dirname(dir);
  } while (++count < 50 && dir !== prevDir);

  return { config, dir, lerna, lernaDir };
};

export const loadFynpoConfig = (cwd: string = process.cwd(), configPath?: string) => {
  const explorer = cosmiconfigSync("fynpo");
  const explicitPath = configPath ? Path.resolve(cwd, configPath) : undefined;
  const explore = explicitPath ? explorer.load : explorer.search;
  const searchPath = explicitPath ? explicitPath : cwd;
  const config = explore(searchPath);
  return config ? config : null;
};

export const loadConfig = (cwd = process.cwd()) => {
  let fynpoRc = {};
  let dir = cwd;

  const loaded = loadFynpoConfig(cwd);
  if (loaded && !loaded.isEmpty) {
    fynpoRc = loaded.config;
    dir = loaded.filepath ? Path.dirname(loaded.filepath) : cwd;
    return { fynpoRc, dir };
  }

  const data = _searchForFynpo(cwd);

  if (!data.config) {
    if (data.lerna) {
      logger.info("found lerna.json at", data.lernaDir, "adding fynpo signature");
      fynpoRc = { ...data.lerna, fynpo: true };
      Fs.writeFileSync(Path.join(data.lernaDir, "lerna.json"), JSON.stringify(fynpoRc) + "\n");
    } else {
      logger.info("creating fynpo.json at", cwd);
      Fs.writeFileSync(Path.join(cwd, "fynpo.json"), "{}\n");
      dir = cwd;
    }
  } else {
    fynpoRc = data.config;
    dir = data.dir;
  }

  return { fynpoRc, dir };
};

export const getRootScripts = (cwd = process.cwd()) => {
  const config = JSON.parse(Fs.readFileSync(Path.join(cwd, "package.json")).toString());
  return config.scripts || {};
};

export const getGlobalFynpo = async (globalNmDir = null) => {
  globalNmDir = globalNmDir || (await locateGlobalNodeModules());

  if (!globalNmDir) {
    logger.error("Unable to locate your global node_modules from", process.argv[0]);
    return {};
  }

  try {
    const dir = Path.join(globalNmDir, "fynpo");
    /* eslint-disable @typescript-eslint/no-var-requires */
    const pkgJson = require(Path.join(dir, "package.json"));
    return pkgJson;
  } catch (e) {
    return {};
  }
};

export const generateLintConfig = (override) => {
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

  return Object.assign({}, config, override);
};

export const generateFynpoConfig = (override: any = {}, opts) => {
  const config = {
    changeLogMarkers: ["## Packages", "## Commits"],
    command: {
      publish: {
        tags: {},
        versionTagging: {},
      },
    },
  };

  const finalConfig = Object.assign({}, config, override);

  if (opts.commitlint) {
    finalConfig.commitlint = generateLintConfig(override.commitlint);
  }

  return finalConfig;
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
