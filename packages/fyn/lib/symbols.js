"use strict";

const LOCK_RSEMVERS = Symbol("lock rsemvers"); // resolved semvers from lock
const SEMVER = Symbol("semver"); // depInfo semver
const RSEMVERS = Symbol("rsemvers"); // resolved semvers
const LOCK_SORTED_VERSIONS = Symbol("lock sorted versions");
const LATEST_TAG_VERSION = Symbol("latest tag version");
const LATEST_VERSION_TIME = Symbol("latest version time");
const SORTED_VERSIONS = Symbol("sorted versions");
const LATEST_SORTED_VERSIONS = Symbol("latest sorted versions");
const LOCAL_VERSION_MAPS = Symbol("local version maps");
const RESOLVE_ORDER = Symbol("resolve order");
const PACKAGE_RAW_INFO = Symbol("package.json raw info");
const DEP_ITEM = Symbol("dep item");

module.exports = {
  SEMVER,
  RSEMVERS,
  LOCK_RSEMVERS,
  SORTED_VERSIONS,
  LATEST_VERSION_TIME,
  LATEST_SORTED_VERSIONS,
  LOCK_SORTED_VERSIONS,
  LATEST_TAG_VERSION,
  LOCAL_VERSION_MAPS,
  RESOLVE_ORDER,
  PACKAGE_RAW_INFO,
  DEP_ITEM
};
