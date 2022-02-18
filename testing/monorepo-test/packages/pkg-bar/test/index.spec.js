const { expect } = require("chai");
const { foo } = require("pkg-foo");

describe("bar", function () {
  it("should import foo", () => {
    expect(foo()).to.equal("foo");
  });
});
