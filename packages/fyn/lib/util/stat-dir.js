"use strict";

/* eslint-disable max-params, max-statements */

const Fs = require("./file-ops");
const Path = require("path");
const mm = require("minimatch");
const filterScanDir = require("filter-scan-dir");

async function _scanFileStats(dir, ignores, baseDir = "") {
  const ignore = fullPath => ignores.find(pattern => mm(fullPath, pattern, { dot: true }));

  let latestMtimeMs = 0;
  let latestFile = "";

  const updateLatest = (mtimeMs, file) => {
    if (mtimeMs > latestMtimeMs) {
      latestMtimeMs = mtimeMs;
      latestFile = file;
    }
  };

  const filter = (file, path, extras) => {
    if (ignore(extras.fullFile)) {
      return false;
    }
    updateLatest(extras.stat.mtimeMs, extras.fullFile);
    return true;
  };

  const fullDir = Path.join(baseDir, dir);
  const topDirStat = await Fs.stat(fullDir);
  updateLatest(topDirStat.mtimeMs, fullDir);

  await filterScanDir({
    dir: fullDir,
    includeRoot: false,
    filter,
    filterDir: filter,
    concurrency: 500,
    fullStat: true // we need full stat to get the mtimeMs prop
  });

  return { latestMtimeMs, latestFile };
}

function scanFileStats(dir, options = {}) {
  // TODO: make this more flexible and configurable
  const ignores = [
    `**/?(node_modules|.vscode|.DS_Store|coverage|.nyc_output|.fynpo|.git|.github|.gitignore)`,
    "**/*.?(log|md)"
  ]
    .concat(options.ignores || `**/?(docs|docusaurus|packages|tmp|.etmp|samples|dist)`)
    .concat(options.moreIgnores)
    .filter(x => x);

  return _scanFileStats(dir, ignores, "");
}

exports.scanFileStats = scanFileStats;

// async function test() {
//   console.log(await scanFileStats("."));
// }

// test();
