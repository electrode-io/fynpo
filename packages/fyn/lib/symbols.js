"use strict";

const LOCK_RSEMVERS = Symbol("lock rsemvers"); // resolved semvers from lock
const SEMVER = Symbol("semver"); // depInfo semver
const RSEMVERS = Symbol("rsemvers"); // resolved semvers
const LOCK_SORTED_VERSIONS = Symbol("lock sorted versions");
const SORTED_VERSIONS = Symbol("sorted versions");
const LOCAL_VERSION_MAPS = Symbol("local version maps");
const RESOLVE_ORDER = Symbol("resolve order");

module.exports = {
  SEMVER,
  RSEMVERS,
  LOCK_RSEMVERS,
  SORTED_VERSIONS,
  LOCK_SORTED_VERSIONS,
  LOCAL_VERSION_MAPS,
  RESOLVE_ORDER
};
