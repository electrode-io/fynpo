import { describe, it, expect } from "@jest/globals";
import { readFynpoPackages } from "../src/index";
import path from "path";

describe("read packages from repo", () => {
  it("should read packages", async () => {
    const packages: any = await readFynpoPackages({ cwd: path.join(__dirname, "sample") });
    expect(packages).toHaveProperty("pkg1");
    expect(packages).toHaveProperty("pkg2");
  });
});
