"use strict";

const semver = require("../../../lib/util/semver");

describe("semver", function() {
  describe("split", function() {
    it("should split", () => {
      expect(semver.split("0.8.3")).to.deep.equal(["0.8.3"]);
      expect(semver.split("0.8.3", "-")).to.deep.equal(["0.8.3"]);
      expect(semver.split("0.8.3", "-", 1)).to.deep.equal(["0.8.3"]);
      expect(semver.split("0.8.3--rc")).to.deep.equal(["0.8.3--rc"]);
      expect(semver.split("0.8.3--rc", "-")).to.deep.equal(["0.8.3", "-rc"]);

      expect(semver.split("@foo/bar", "@", 1)).to.deep.equal(["@foo/bar"]);
      expect(semver.split("@foo/bar", "@")).to.deep.equal(["", "foo/bar"]);
      expect(semver.split("@foo/bar@0.8.3", "@", 1)).to.deep.equal(["@foo/bar", "0.8.3"]);
    });
  });

  describe("simpleCompare", function() {
    it("should handle 0.8.3 vs 0.8.3--rc", () => {
      expect(semver.simpleCompare("0.8.3", "0.8.3--rc")).to.equal(1);
      expect(semver.simpleCompare("0.8.3--rc", "0.8.3")).to.equal(-1);
    });

    it("should handle both have suffix", () => {
      expect(semver.simpleCompare("0.8.3-a", "0.8.3-b")).to.equal(1);
      expect(semver.simpleCompare("0.8.3-b", "0.8.3-a")).to.equal(-1);
    });

    it("should handle identical/same versions", () => {
      expect(semver.simpleCompare("0.8.3", "0.8.3")).to.equal(0);
      expect(semver.simpleCompare("10.08.003", "010.8.03")).to.equal(0);
    });

    it("should handle numerical diff versions", () => {
      expect(semver.simpleCompare("0.8.4", "0.8.3")).to.equal(-1);
      expect(semver.simpleCompare("0.09.3", "0.8.3")).to.equal(-1);
      expect(semver.simpleCompare("01.8.3", "0.8.3")).to.equal(-1);

      expect(semver.simpleCompare("0.8.3", "0.8.4")).to.equal(1);
      expect(semver.simpleCompare("0.8.3", "0.09.3")).to.equal(1);
      expect(semver.simpleCompare("0.8.3", "01.8.3")).to.equal(1);
    });
  });

  describe("localify", function() {
    it("should add tag", () => {
      const x = semver.localify("0.1.1");
      expect(x).to.equal("0.1.1-fynlocal");
      expect(semver.isLocal(x)).to.be.true;
    });

    it("should add tag with hash", () => {
      const x = semver.localify("0.1.1", false, "xyz");
      expect(x).to.equal("0.1.1-fynlocalxyz");
      expect(semver.isLocal(x)).to.be.true;
    });
  });

  describe("unlocalify", function() {
    it("should remove tag", () => {
      expect(semver.unlocalify("0.1.1-fynlocal")).to.equal("0.1.1");
    });

    it("should remove tag with hash", () => {
      expect(semver.unlocalify("0.1.1-fynlocalxyz")).to.equal("0.1.1");
    });

    it("should do nothing if there's no tag", () => {
      expect(semver.unlocalify("0.1.1")).to.equal("0.1.1");
    });
  });

  describe("equal", function() {
    it("should return true for one fynlocal versions", () => {
      expect(semver.equal("0.1.1-fynlocal", "0.1.1")).to.be.true;
    });

    it("should return true for two fynlocal versions", () => {
      expect(semver.equal("0.1.1-fynlocal", "0.1.1-fynlocal")).to.be.true;
    });

    it("should return false for two fynlocal diff versions", () => {
      expect(semver.equal("0.1.1-fynlocal", "0.1.2-fynlocal")).to.be.false;
    });

    it("should return false for two versions with diff fynlocals", () => {
      expect(semver.equal("0.1.1-fynlocalxyz", "0.1.1-fynlocalabc")).to.be.false;
    });
  });

  describe("satisfies", function() {
    it("should return true for non fynlocal version", () => {
      expect(semver.satisfies("0.1.1", "^0.1.0")).to.be.true;
    });

    it("should return true for fynlocal version", () => {
      expect(semver.satisfies("0.1.1-fynlocal123", "^0.1.0")).to.be.true;
    });

    it("should return false for unmatch fynlocal version", () => {
      expect(semver.satisfies("0.1.1-fynlocal123", "^0.2.0")).to.be.false;
    });

    it("should return false for unmatch  version", () => {
      expect(semver.satisfies("0.1.1", "^0.2.0")).to.be.false;
    });
  });

  describe("clean", function() {
    it("should clean 3001.0001.0000-dev-harmony-fb", () => {
      expect(semver.clean("3001.0001.0000-dev-harmony-fb")).to.equal("3001.1.0-dev-harmony-fb");
    });

    it("should clean 2.1.17+deprecated", () => {
      expect(semver.clean("2.1.17+deprecated")).to.equal("2.1.17");
    });
  });
});
