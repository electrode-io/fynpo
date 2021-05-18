"use strict";

const Path = require("path");
const Fs = require("fs");

module.exports = {
  title: "should link new bin and remove old ones when update dep",
  verify: cwd => {
    const link = Fs.readlinkSync(Path.join(cwd, "node_modules/mod-g"));
    expect(link).contains("3.0.0");
  }
};
