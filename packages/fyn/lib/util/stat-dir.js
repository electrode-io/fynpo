"use strict";

/* eslint-disable max-params */

const Fs = require("./file-ops");
const Path = require("path");

const latestCtimeTag = (exports.latestCtimeTag = "~ lastest ctime ~");
const dirCtimeTag = (exports.dirCtimeTag = "~ dir ctime ~");

async function _scanFileStats(dir, output, ignores, baseDir = "") {
  if (ignores.includes(dir)) {
    return output;
  }

  const fullDir = Path.join(baseDir, dir);

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
    const newOutput = (output[dir] = {
      [dirCtimeTag]: ctime,
      [latestCtimeTag]: 0
    });

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
    "node_modules",
    ".nyc_output",
    "coverage",
    ".fynpo",
    ".git",
    ".github",
    "docs",
    "docusaurus",
    "packages",
    "tmp",
    ".etmp",
    "fyn-debug.log"
  ]
    .concat(options.ignores)
    .filter(x => x);

  const output = { [latestCtimeTag]: 0 };

  return _scanFileStats(dir, output, ignores, "");
}

exports.scanFileStats = scanFileStats;

// async function test() {
//   console.log(JSON.stringify(await scanFileStats("packages/xarc-app"), null, 2));
// }

// test();
