"use strict";

module.exports = {
  MARK_URL_SPEC: "~url-spec~",
  // FYN_IGNORE_FILE: "__fyn_ignore__",
  // to be deprecated: no longer use the flat module setup
  // /*deprecated*/ FYN_RESOLUTIONS_JSON: "__fyn_resolutions__.json",
  // /*deprecated*/ FYN_LINK_JSON: "__fyn_link__.json",
  PACKAGE_FYN_JSON: "package-fyn.json",
  //
  // Save a config file to output dir (node_modules) to remember the
  // config used to do install.  Mainly added to remember central store
  // dir because if user run install on an exist node_modules that
  // used central store without specifying the flag again, we still
  // need to run install with central store pointing to the original dir.
  //
  FYN_INSTALL_CONFIG_FILE: ".fyn.json",
  FV_DIR: ".f",
  FYN_LOCK_FILE: "fyn-lock.yaml"
};
