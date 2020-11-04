"use strict";

/* eslint-disable max-params, max-statements */

const Fs = require("./file-ops");
const Path = require("path");
const mm = require("minimatch");

const latestCtimeTag = (exports.latestCtimeTag = Symbol("latestCtime"));
const dirCtimeTag = (exports.dirCtimeTag = Symbol("ctime"));

async function _scanFileStats(dir, output, ignores, baseDir = "") {
  const fullDir = Path.join(baseDir, dir);

  const forMatch = Path.sep === "/" ? fullDir : fullDir.replace(/\\/g, "/");

  if (ignores.find(pattern => mm(forMatch, pattern, { dot: true }))) {
    return output;
  }

  const stat = await Fs.stat(fullDir);
  const updateLatest = ctime => {
    if (ctime > output[latestCtimeTag]) {
      output[latestCtimeTag] = ctime;
    }
  };

  const ctime = stat.ctime.getTime();
  if (!stat.isDirectory()) {
    output[dir] = ctime;
    updateLatest(ctime);
  } else {
    let newOutput;

    if (fullDir === baseDir || fullDir === ".") {
      output[dirCtimeTag] = ctime;
      newOutput = output;
    } else {
      newOutput = output[dir] = {
        [dirCtimeTag]: ctime,
        [latestCtimeTag]: 0
      };
    }

    const files = await Fs.readdir(fullDir);
    for (const f of files) {
      await _scanFileStats(f, newOutput, ignores, fullDir);
      updateLatest(newOutput[latestCtimeTag]);
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
    .concat(options.ignores || `**/?(docs|docusaurus|packages|tmp|.etmp|samples)`)
    .concat(options.moreIgnores)
    .filter(x => x);

  const output = { [latestCtimeTag]: 0 };

  return _scanFileStats(dir, output, ignores, "");
}

exports.scanFileStats = scanFileStats;

// async function test() {
//   console.log(await scanFileStats("."));
// }

// test();
