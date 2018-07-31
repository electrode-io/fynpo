"use strict";

const xaa = require("../../../lib/util/xaa");

describe("xaa", function() {
  describe("map", function() {
    it("should await with concurrency > 1", async () => {
      const start = Date.now();
      const result = await xaa.map([30, 40, 50, 30, 15, 50, 20], xaa.delay, { concurrency: 4 });
      const end = Date.now();
      const diff = end - start;
      expect(diff, "should take less than 115ms").to.below(115);
      expect(diff, "should take more than 99ms").to.above(99);
      expect(result).to.deep.equal([0, 1, 2, 3, 4, 5, 6]);
    }).timeout(5000);
  });
});
