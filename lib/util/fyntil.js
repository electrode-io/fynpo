"use strict";

/* eslint-disable no-process-exit */

module.exports = {
  exit: function exit(err) {
    process.exit(err ? 1 : 0);
  },
  makeFynLinkFName: pkgName => {
    return `__fyn_link_${pkgName}__.json`.replace(/[@\/]/g, "-");
  }
};
