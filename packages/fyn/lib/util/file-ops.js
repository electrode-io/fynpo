"use strict";

const opfs = require("opfs");
opfs._opfsSetPromise(require("bluebird"));
module.exports = opfs;
