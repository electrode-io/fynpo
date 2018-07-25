"use strict";

const Path = require("path");
const hardLinkDir = require("../../../lib/util/hard-link-dir");
const Fs = require("opfs");

describe("hard-link-dir", function() {
  it("should hard link a package directory", () => {
    const destPath = Path.join(__dirname, "hard_link_mog_g");
    return Fs.mkdir(destPath)
      .catch(() => {})
      .then(() => {
        return hardLinkDir.link(Path.join(__dirname, "../../fixtures/mod-g"), destPath);
      })
      .finally(() => Fs.$.rimraf(destPath));
  });
});
