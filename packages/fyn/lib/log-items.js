"use strict";

const VisualLogger = require("visual-logger");
const FETCH_META = "fetch meta";
const FETCH_PACKAGE = "fetch package";
const LONG_WAIT_META = "meta still pending";
const LOAD_PACKAGE = "load package";
const LONG_WAIT_PACKAGE = "package pending fetch";
const INSTALL_PACKAGE = "install package";
const NETWORK_ERROR = "network error";
const OPTIONAL_RESOLVER = "optional resolver";
const spinner = VisualLogger.spinners[1];

module.exports = {
  FETCH_META,
  FETCH_PACKAGE,
  LONG_WAIT_META,
  LOAD_PACKAGE,
  LONG_WAIT_PACKAGE,
  INSTALL_PACKAGE,
  NETWORK_ERROR,
  OPTIONAL_RESOLVER,
  spinner
};
