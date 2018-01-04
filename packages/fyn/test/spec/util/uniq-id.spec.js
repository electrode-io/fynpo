"use strict";

const uniqId = require("../../../lib/util/uniq-id");

describe("uniq-id", function() {
  it("should generate random ids", () => {
    let last;
    let id;
    for (let i = 0; i < 100; i++) {
      id = uniqId();
      expect(id).to.not.equal(last);
      last = id;
    }
  });
});
