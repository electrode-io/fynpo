import { runInitPackage } from "../src";
import { describe, it, expect } from "@jest/globals";

describe("init-package", function () {
  it("should have runInitPackage", () => {
    expect(runInitPackage).toBeInstanceOf(Function);
  });
});
