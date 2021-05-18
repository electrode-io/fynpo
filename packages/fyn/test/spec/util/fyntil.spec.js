"use strict";

const { expect } = require("chai");
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

  describe("retry", function() {
    it("should retry if checks array contains allowed code", () => {
      let count = 0;
      return fyntil
        .retry(
          () => {
            count++;
            if (count < 2) {
              const err = new Error("test");
              err.code = "test";
              throw err;
            }
          },
          ["test"],
          5,
          10
        )
        .then(() => {
          expect(count).to.equal(2);
        });
    });

    it("should not retry if checks array does not contains allowed code", () => {
      let count = 0;
      let error;

      return fyntil
        .retry(
          () => {
            count++;
            if (count < 2) {
              const err = new Error("test");
              err.code = "test";
              throw err;
            }
          },
          ["blah"],
          5,
          10
        )
        .catch(err => {
          error = err;
        })
        .then(() => {
          expect(error).to.exist;
          expect(error.message).to.equal("test");
          expect(count).to.equal(1);
        });
    });

    it("should not retry if func succeeds first time", () => {
      return fyntil.retry(
        () => {},
        () => {
          throw new Error("should not retry");
        },
        5,
        10
      );
    });

    it("should not retry if check returns false", () => {
      let error;
      let count = 0;
      return fyntil
        .retry(
          () => {
            count++;
            throw new Error("test");
          },
          () => false,
          5,
          10
        )
        .catch(err => (error = err))
        .then(() => {
          expect(error).to.exist;
          expect(count).to.equal(1);
        });
    });

    it("should fail afer all retries", () => {
      let error;
      return fyntil
        .retry(
          () => {
            throw new Error("test failure");
          },
          () => {
            return true;
          },
          3,
          10
        )
        .catch(err => (error = err))
        .then(() => {
          expect(error).to.exist;
          expect(error.message).to.equal("test failure");
        });
    });
  });

  describe("checkValueSatisfyRules", () => {
    it("should return true for no rules", () => {
      expect(fyntil.checkValueSatisfyRules(null, "a")).equal(true);
      expect(fyntil.checkValueSatisfyRules("", "a")).equal(true);
    });

    it("should deny ! value", () => {
      expect(fyntil.checkValueSatisfyRules(["!test"], "test")).equal(false);
    });

    it("should return true for no explicit accept values", () => {
      expect(fyntil.checkValueSatisfyRules([], "blah")).equal(true);
      expect(fyntil.checkValueSatisfyRules(["!foo"], "blah")).equal(true);
    });

    it("should deny value that's not listed", () => {
      expect(fyntil.checkValueSatisfyRules(["foo"], "blah")).equal(false);
    });
  });

  describe("relativePath", () => {
    it("return dir with leading .", () => {
      expect(fyntil.relativePath("/blah/foo/test/abc", "/blah/foo/test/abc/def")).equals("./def");
    });

    it("return relative dir", () => {
      expect(fyntil.relativePath("/blah/foo/test/abc", "/blah/foo/test/xyz/123")).equals(
        "../xyz/123"
      );
    });
  });
});
