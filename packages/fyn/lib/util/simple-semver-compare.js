"use strict";

//
// Simplified compare two numeric versions in semver format for sorting
// in descending order.
//
// - Assume versions are not expressions that could match multiple versions
// - Assume versions are properly formed
//

/* eslint-disable max-statements */

module.exports = function simpleSemverCompare(a, b) {
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
};
