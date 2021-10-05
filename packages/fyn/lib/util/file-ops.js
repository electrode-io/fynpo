"use strict";

const Promise = require("bluebird");
const opfs = require("opfs");
const lockfile = require("lockfile");
const win32Opfs = require("./file-ops-win32");

opfs._opfsSetPromise(Promise);

opfs.$.acquireLock = Promise.promisify(lockfile.lock, { context: lockfile });
opfs.$.releaseLock = Promise.promisify(lockfile.unlock, { context: lockfile });

module.exports = win32Opfs(opfs);
