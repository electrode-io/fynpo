"use strict";

const xaa = require("xaa");

const Path = require("path");
const Fs = require("fs");
module.exports = {
  title: "should update link that changed",
  verify: async cwd => {
    await xaa.delay(100);
    debugger;
    // const link = Fs.readlinkSync(Path.join(cwd, "node_modules/mod-g"));
    // expect(link).contains("4.0.0");
  }
};
