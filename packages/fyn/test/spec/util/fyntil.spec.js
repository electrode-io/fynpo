"use strict";

const fyntil = require("../../../lib/util/fyntil");

describe("fyntil", function() {
  describe("exit", function() {
    it("call process.exit", () => {
      const save = process.exit;
      let code;
      process.exit = c => (code = c);
      fyntil.exit();
      expect(code).to.equal(0);
      fyntil.exit(new Error());
      expect(code).to.equal(1);
      process.exit = save;
    });
  });
});
