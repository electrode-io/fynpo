"use strict";

const { isWin32, retry } = require("./base-util");

//
// This rather puzzling retry clutch here is very mysterious to me as well.
// For some reason, on Windows (mainly windows 10, many releases), either
// on a real machine or a VM, fs operations would fail with EACCESS or EPERM
// randomly, even on files that were just created two lines before or a few
// seconds before.  100 % of the time retrying a few times would work.
//
// This behavior affects npm (many versions) as well.
//
// Unfortunately, this also affects any external package or module that use fs,
// such as lockfile, and we need to retry calling their APIs.
//
const FS_RETRIES = isWin32 ? 10 : 0;
const FS_RETRY_ERRORS = isWin32 ? ["EACCESS", "EPERM"] : [];
const FS_RETRY_WAIT = 100;

const _retry = func => retry(func, FS_RETRY_ERRORS, FS_RETRIES, FS_RETRY_WAIT);

module.exports = function(opfs) {
  if (isWin32) {
    return {
      ...opfs,
      $: {
        ...opfs.$,
        mkdirp: (...args) => _retry(() => opfs.$.mkdirp(...args)),
        acquireLock: (...args) => _retry(() => opfs.$.acquireLock(...args)),
        releaseLock: (...args) => _retry(() => opfs.$.releaseLock(...args))
      },
      stat: (...args) => _retry(() => opfs.stat(...args)),
      readFile: (...args) => _retry(() => opfs.readFile(...args)),
      writeFile: (...args) => _retry(() => opfs.writeFile(...args)),
      rename: (...args) => _retry(() => opfs.rename(...args)),
      rmdir: (...args) => _retry(() => opfs.rmdir(...args)),
      unlink: (...args) => _retry(() => opfs.unlink(...args)),
      readdir: (...args) => _retry(() => opfs.readdir(...args))
    };
  } else {
    return opfs;
  }
};
