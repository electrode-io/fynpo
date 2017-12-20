"use strict";

module.exports = function _sortObjKeys(obj) {
  const sorted = {};
  Object.keys(obj)
    .sort()
    .forEach(k => (sorted[k] = obj[k]));
  return sorted;
};
