"use strict";

/* eslint-disable prefer-spread */

const mockRequire = require("mock-require");

describe("fyn-config", function() {
  describe("fynDir", () => {
    let xenvStub;
    before(() => {
      delete require.cache[require.resolve("../../lib/fyn-config")];
      delete require.cache[require.resolve("xenv-config")];
      mockRequire("xenv-config", function() {
        return xenvStub.apply(null, Array.prototype.slice.apply(arguments));
      });
    });

    after(() => {
      mockRequire.stopAll();
    });

    it("should have post processor", () => {
      let spec;
      xenvStub = x => {
        spec = x;
        return { fynDir: "test" };
      };
      const fynConfig = require("../../lib/fyn-config");
      fynConfig({});
      expect(spec).to.exist;
      expect(spec.fynDir.post).to.exist;
      expect(
        spec.fynDir.post("test", { src: "env", name: "HOME" }),
        "should append .fyn to user HOME dir for fynDir"
      ).to.equal("test/.fyn");

      expect(
        spec.fynDir.post("test", { src: "default" }),
        "should append .fyn to default dir for fynDir"
      ).to.equal("test/.fyn");
    });
  });
});
