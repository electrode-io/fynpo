"use strict";

const pathUpEach = require("../../../lib/util/path-up-each");

describe("path-up-each", function() {
  it("should return empty if path immediately triggers stop", () => {
    const found = pathUpEach("/test/foo", ["foo"]);
    expect(found).to.deep.equal([]);
  });

  it("should find one if stopping triggers on first up", () => {
    const found = pathUpEach("/test/foo/blah", ["foo"]);
    expect(found).to.deep.equal(["/test/foo/blah"]);
  });

  it("should take callback for stopping", () => {
    const found = pathUpEach("/test/foo/bar", x => x === "/test");
    expect(found).to.deep.equal(["/test/foo/bar", "/test/foo"]);
  });

  it("should stop if can't cd .. further", () => {
    let found = pathUpEach("", ["foo"]);
    expect(found).to.deep.equal([]);
    found = pathUpEach("/foo/test", []);
    expect(found).to.deep.equal(["/foo/test", "/foo", "/"]);
    found = pathUpEach("foo/test", []);
    expect(found).to.deep.equal(["foo/test", "foo"]);
  });
});
