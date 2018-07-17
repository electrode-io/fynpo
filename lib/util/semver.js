"use strict";

const Semver = require("semver");
const Path = require("path");
const os = require("os");

//
// Simplified compare two numeric versions in semver format for sorting
// in descending order.
//
// - Assume versions are not expressions that could match multiple versions
// - Assume versions are properly formed
//

/* eslint-disable max-statements, no-magic-numbers, complexity */

function split(v, sep, index = 0) {
  const x = v.indexOf(sep, index);
  if (x >= index) {
    return [v.substr(0, x), v.substr(x + 1)];
  }

  return [v];
}

function simpleCompare(a, b) {
  if (a === b) {
    return 0;
  }

  const partsA = split(a, "-");
  const partsB = split(b, "-");

  const splitsA = partsA[0].split(".");
  const splitsB = partsB[0].split(".");

  let i;

  // do numerical compare on each part [major.minor.patch]
  for (i = 0; i < splitsA.length; i++) {
    const aN = parseInt(splitsA[i], 10);
    const bN = parseInt(splitsB[i], 10);

    if (aN > bN) {
      return -1;
    }

    if (aN < bN) {
      return 1;
    }
  }

  if (partsA[1]) {
    // both has parts after -
    if (partsB[1]) {
      return partsA[1] > partsB[1] ? -1 : 1;
    }
    // only A has parts after -
    return -1;
  } else if (partsB[1]) {
    // only B has parts after -
    return 1;
  } else {
    return 0; // numerical compare was the same
  }
}

//
// Try to fix any semver that's not valid.
//
// Some package has version that's not a valid semver but was published
// with it fixed in the meta but not in its package.json or tarball.
// ie: 3001.0001.0000-dev-harmony-fb to 3001.1.0-dev-harmony-fb
// and: 2.1.17+deprecated to 2.1.17
//
function clean(v) {
  const f = v.split("-");
  const vpart = f[0].split("+")[0];
  const mmp = vpart.split(".").map(x => (x && parseInt(x, 10)) || 0);
  f[0] = mmp.join(".");
  return f.join("-");
}

const FYN_LOCAL_TAG = "-fynlocal";
const FYN_LOCAL_HARD_TAG = "-fynlocal_h";

function isLocal(v) {
  return v.indexOf(FYN_LOCAL_TAG) > 0;
}

function isLocalHard(v) {
  return v.indexOf(FYN_LOCAL_HARD_TAG) > 0;
}

function localify(v, hash = "") {
  return `${v}${FYN_LOCAL_TAG}${hash}`;
}

function localifyHard(v, hash = "") {
  return `${v}${FYN_LOCAL_HARD_TAG}${hash}`;
}

function unlocalify(v) {
  const x = v.indexOf(FYN_LOCAL_TAG);
  return x > 0 ? v.substr(0, x) : v;
}

function localSplit(v) {
  const x = v.indexOf(FYN_LOCAL_TAG);
  if (x > 0) {
    return [v.substr(0, x), v.substr(x)];
  }

  return [v];
}

// https://docs.npmjs.com/files/package.json#dependencies
function getAsFilepath(semver) {
  const a = semver[0];
  const b = semver[1];

  if (b === ":") {
    // no semver can have : in second char, so assume windows <drive>:\
    return semver;
  } else if (a === ".") {
    // ./, ../, .\, ..\\
    if (b === "/" || b === "\\" || (b === "." && (semver[2] === "\\" || semver[2] === "/"))) {
      return semver;
    }
  } else if (a === "\\" || a === "/") {
    return semver;
  } else if (semver.startsWith("~/")) {
    return Path.join(os.homedir(), semver.substr(1));
  }

  return false;
}

function analyze(semver) {
  const sv = { $: semver };

  if (semver.startsWith("file:")) {
    sv.path = semver.substr(5);
    sv.localType = "hard";
  } else {
    const fp = getAsFilepath(semver);
    if (fp) {
      sv.path = fp;
      sv.localType = "sym";
    }
  }

  return sv;
}

module.exports = {
  satisfies: (v, semver) => {
    return Semver.satisfies(unlocalify(v), semver);
  },

  split,

  analyze,

  localify,
  localifyHard,
  unlocalify,
  isLocal,
  isLocalHard,

  clean,

  equal: (v1, v2) => {
    v1 = localSplit(v1);
    v2 = localSplit(v2);
    return v1[0] === v2[0] && (v1[1] && v2[1] ? v1[1] === v2[1] : true);
  },

  simpleCompare,

  getAsFilepath
};
