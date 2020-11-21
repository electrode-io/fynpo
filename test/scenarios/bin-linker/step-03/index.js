"use strict";

const Path = require("path");
const Fs = require("fs");
module.exports = {
  title: "should update link that changed",
  verify: cwd => {
    const link = Fs.readlinkSync(Path.join(cwd, "node_modules/mod-g"));
    expect(link).contains("4.0.0");
  }
};
