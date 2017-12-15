"use strict";

//
// Try to fix any semver that's not valid.
//
// Some package has version that's not a valid semver but was published
// with it fixed in the meta but not in its package.json or tarball.
// ie: 3001.0001.0000-dev-harmony-fb to 3001.1.0-dev-harmony-fb
// and: 2.1.17+deprecated to 2.1.17
//
module.exports = function fixSemver(v) {
  const f = v.split("-");
  const vpart = f[0].split("+")[0];
  const mmp = vpart.split(".").map(x => (x && parseInt(x, 10)) || 0);
  f[0] = mmp.join(".");
  return f.join("-");
};
