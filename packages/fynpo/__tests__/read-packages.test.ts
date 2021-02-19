import { describe, it, expect } from "@jest/globals";
import readPackages from "../src/read-packages";
import path from "path";

describe("read packages from repo", () => {
  it("should read packages", () => {
    const packages = readPackages(path.join(__dirname, "sample"));
    expect(packages).toHaveProperty("pkg1");
    expect(packages).toHaveProperty("pkg2");
  });
});
