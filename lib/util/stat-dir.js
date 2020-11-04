"use strict";

/* eslint-disable max-params, max-statements */

const Fs = require("./file-ops");
const Path = require("path");
const mm = require("minimatch");

const latestMtimeTag = (exports.latestMtimeTag = Symbol("latestMtime"));
const dirMtimeTag = (exports.dirMtimeTag = Symbol("mtime"));

async function _scanFileStats(dir, output, ignores, baseDir = "") {
  const fullDir = Path.join(baseDir, dir);

  const forMatch = Path.sep === "/" ? fullDir : fullDir.replace(/\\/g, "/");

  if (ignores.find(pattern => mm(forMatch, pattern, { dot: true }))) {
    return output;
  }

  const stat = await Fs.stat(fullDir);
  const updateLatest = mtime => {
    if (mtime > output[latestMtimeTag]) {
      output[latestMtimeTag] = mtime;
    }
  };

  const mtime = stat.mtime.getTime();
  if (!stat.isDirectory()) {
    output[dir] = mtime;
    updateLatest(mtime);
  } else {
    let newOutput;

    if (fullDir === baseDir || fullDir === ".") {
      output[dirMtimeTag] = mtime;
      newOutput = output;
    } else {
      newOutput = output[dir] = {
        [dirMtimeTag]: mtime,
        [latestMtimeTag]: 0
      };
    }

    const files = await Fs.readdir(fullDir);
    for (const f of files) {
      await _scanFileStats(f, newOutput, ignores, fullDir);
      updateLatest(newOutput[latestMtimeTag]);
    }
  }

  return output;
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

  const output = { [latestMtimeTag]: 0 };

  return _scanFileStats(dir, output, ignores, "");
}

exports.scanFileStats = scanFileStats;

// async function test() {
//   console.log(await scanFileStats("."));
// }

// test();
