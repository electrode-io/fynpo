"use strict";

const logger = require("../../../../lib/logger");
const stripAnsi = require("strip-ansi");

module.exports = {
  title: "should warn peer dep missing",
  verify: () => {
    const msg = "Warning: peer dependencies mod-a@^0.3.0 of mod-f@2.1.1 is missing";
    const warning = logger.logData.map(x => stripAnsi(x)).find(x => x.indexOf(msg) > 0);
    expect(warning).contains(msg);
  }
};
