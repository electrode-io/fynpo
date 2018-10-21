const Fs = require("fs");

module.exports = {
  title: "fail install package where cpu not match",
  expectFailure: err => {
    const ix = err.message.indexOf(
      `platform check failed: your cpu/arch ${
        process.arch
      } doesn't satisfy required cpu foo,bar,blah`
    );
    if (ix < 0) {
      throw err;
    }
  }
};
