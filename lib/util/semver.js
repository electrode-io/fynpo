"use strict";

const Semver = require("semver");

//
// Simplified compare two numeric versions in semver format for sorting
// in descending order.
//
// - Assume versions are not expressions that could match multiple versions
// - Assume versions are properly formed
//

/* eslint-disable max-statements */

function simpleCompare(a, b) {
  if (a === b) {
    return 0;
  }

  const partsA = a.split("-");
  const partsB = b.split("-");

  const splitsA = partsA[0].split(".");
  const splitsB = partsB[0].split(".");
  let i;

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

  if (partsA[1] && partsB[1]) {
    return partsA[1] > partsB[1] ? -1 : 1;
  }

  if (partsA[1]) {
    return -1;
  }

  if (partsB[1]) {
    return 1;
  }

  //
  // What could make the flow end up here?
  // - Versions like 1.01.02, which is considered equal to 1.1.2?
  //
  return 0;
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

function fynify(v) {
  const x = v.indexOf("-fynlocal");
  return x > 0 ? v.substr(0, x) : v;
}

module.exports = {
  satisfies: (v, semver) => {
    return Semver.satisfies(fynify(v), semver);
  },

  fynify,

  clean,

  equal: (v1, v2) => fynify(v1) === fynify(v2),

  simpleCompare
};
