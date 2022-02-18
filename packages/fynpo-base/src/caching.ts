import { filterScanDir, ExtrasData } from "filter-scan-dir";
import mm from "minimatch";
import _ from "lodash";
import Fs from "fs";
import Path from "path";
import Crypto from "crypto";

/**
 *
 */
type FilesFilterPatterns = {
  /**
   * minimatch patterns to filter files to include.
   * Will check files against this first and ignore any unmatched files
   */
  include?: string | string[];
  /**
   * minimatch patterns to filter files to exclude.
   * Check after include patterns, and ignore any matched files.
   */
  exclude?: string | string[];
};

/**
 *
 */
type CacheInput = FilesFilterPatterns & {
  /** npm scripts to include as the input */
  npmScripts?: string | string[];
  /** env variables to include as the input */
  includeEnv?: string | string[];
  /** versions to include as the input */
  includeVersions?: string | string[];
};

/**
 *
 */
type CacheOutput = FilesFilterPatterns & {
  /**
   * use npm pack to create a list of files to include.
   * will check them against the exclude patterns and ignore any that match
   */
  filesFromNpmPack?: boolean;
};

/**
 * generate sha256 has of a file
 *
 * @param filename
 * @returns
 */
async function hashFile(
  filename: string,
  encoding: Crypto.BinaryToTextEncoding = "base64url"
): Promise<string> {
  const data = await Fs.promises.readFile(filename);
  const hash = Crypto.createHash("sha256").update(data).digest(encoding);
  return hash;
}

/**
 * create a sha256 hash for some data
 *
 * @param data
 * @returns
 */
function hashData(data: any, encoding: Crypto.BinaryToTextEncoding = "base64url") {
  return Crypto.createHash("sha256").update(data).digest(encoding);
}

/**
 * generate hash for an array of files
 *
 * @param files
 * @returns object with each file point to its hash
 */
async function hashFiles(
  cwd: string,
  files: string[],
  encoding: Crypto.BinaryToTextEncoding = "base64url"
): Promise<Record<string, string>> {
  const hashes = {};
  const promises = [];
  for (const file of files) {
    promises.push(hashFile(Path.join(cwd, file), encoding).then((h) => (hashes[file] = h)));
  }
  await Promise.all(promises);

  const result = {};

  for (const file of files) {
    result[file] = hashes[file];
  }

  return result;
}

/**
 *
 * @param cwd
 * @returns
 */
async function readPackageJson(cwd: string) {
  return JSON.parse(await Fs.promises.readFile(Path.join(cwd, "package.json"), "utf-8"));
}

/**
 * Convert minimatch string patterns to Minimatch instances
 *
 * @param patterns
 * @returns
 */
function makeMmPatterns(patterns: string | string[], options = { dot: true }) {
  return []
    .concat(patterns)
    .map((x: string) => x && new mm.Minimatch(x, options))
    .filter((x) => x);
}

/**
 *
 * @param fullPath
 * @param patterns
 * @returns
 */
function checkMmMatch(fullPath: string, patterns: mm.IMinimatch[]) {
  return !_.isEmpty(patterns) && patterns.find((patternMm) => patternMm.match(fullPath));
}

/**
 * Scan for files using include and exclude patterns
 *
 * @param cwd
 * @param input
 * @returns
 */
async function scanFiles(
  cwd: string,
  includes: mm.IMinimatch[],
  excludes: mm.IMinimatch[]
): Promise<string[]> {
  const filter = (_file: string, _path: string, extras: ExtrasData) => {
    if (!checkMmMatch(extras.dirFile, includes) || checkMmMatch(extras.dirFile, excludes)) {
      return false;
    }
    return true;
  };

  return (
    await filterScanDir({
      cwd,
      filter,
      filterDir: filter,
      fullStat: false,
      concurrency: 500,
    })
  ).sort();
}

export async function processInput(
  {
    cwd,
    input,
    packageJson,
    extra,
  }: {
    cwd?: string;
    input: CacheInput;
    packageJson?: Record<string, string | unknown>;
    // additional data to add to data for generating hash
    extra?: string;
  } = { input: {} }
) {
  const files = await scanFiles(cwd, makeMmPatterns(input.include), makeMmPatterns(input.exclude));
  const fileHashes = await hashFiles(cwd, files);

  const data = {
    env: _.pick(process.env, input.includeEnv),
    versions: _.pick(process.versions, input.includeVersions),
    npmScripts: _.pick(
      _.get(packageJson || (await readPackageJson(cwd)), "scripts"),
      input.npmScripts
    ),
    fileHashes,
    extra: extra || "", // additional data
  };

  const hash = hashData(JSON.stringify(data));

  return { files, data, hash };
}

/**
 *
 * @param param0
 * @returns
 */
export async function processLifecycleInput(
  {
    cwd,
    input,
    packageJson,
  }: {
    cwd?: string;
    input: CacheInput;
    packageJson?: Record<string, string | unknown>;
  } = { input: {} }
) {
  packageJson = packageJson || (await readPackageJson(cwd));
  const npmScripts = _.pick(_.get(packageJson, "scripts"), input.npmScripts);

  if (_.isEmpty(npmScripts)) {
    return {};
  }

  return await processInput({ cwd, input, packageJson });
}

/**
 * Process build cache output file config.
 *
 * @param param0
 * @returns
 */
export async function processOutput(
  {
    cwd,
    inputHash,
    calcHash,
    output,
    preFiles,
  }: {
    /** directory to scan for output files */
    cwd?: string;
    /** input hash that tie to this output */
    inputHash?: string;
    /** Should we calculate hash for the output files? */
    calcHash?: boolean;
    /** output config */
    output: CacheOutput;
    /** list of pre-determined files, will be filtered with output.exclude */
    preFiles?: string[];
  } = { output: {} }
) {
  const mmIncludes = makeMmPatterns(output.include);
  const mmExcludes = makeMmPatterns(output.exclude);

  const files = await scanFiles(cwd, mmIncludes, mmExcludes);

  preFiles = []
    .concat(preFiles)
    .filter((x) => {
      if (!x || checkMmMatch(x, mmExcludes)) {
        return false;
      }
      return true;
    })
    .map((x) => x.replace(`${cwd}${Path.sep}`, ""));

  let hash = "";
  let fileHashes = {};
  const allFiles = _.uniq(files.concat(preFiles)).sort();
  let data = { inputHash, fileHashes };

  //

  if (calcHash) {
    fileHashes = await hashFiles(cwd, allFiles);
    data = { inputHash, fileHashes };
    hash = hashData(JSON.stringify(data));
  }

  //
  return {
    files: allFiles,
    data,
    hash,
    access: Date.now(),
    create: Date.now(),
  };
}
