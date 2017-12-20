"use strict";

const LOCK_RSEMVERS = Symbol("lock rsemvers");
const RSEMVERS = Symbol("rsemvers");
const RVERSIONS = Symbol("rversions");
const LOCK_SORTED_VERSIONS = Symbol("lock sorted versions");
const SORTED_VERSIONS = Symbol("sorted versions");
const LOCAL_VERSION_MAPS = Symbol("local version maps");

module.exports = {
  RSEMVERS,
  LOCK_RSEMVERS,
  RVERSIONS,
  SORTED_VERSIONS,
  LOCK_SORTED_VERSIONS,
  LOCAL_VERSION_MAPS
};
