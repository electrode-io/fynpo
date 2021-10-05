import Fs from "fs";
const pFs = Fs.promises;
import Path from "path";
import logger from "./logger";
import _ from "lodash";
import { cosmiconfigSync } from "cosmiconfig";
import shcmd from "shcmd";
import _optionalRequire from "optional-require";
const optionalRequire = _optionalRequire(require);

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
