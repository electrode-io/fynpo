import shcmd from "shcmd";
import { describe, it, expect } from "@jest/globals";

const execBootstrap = () => {
  const command = "npx ../../dist/fynpo-cli.js";
  shcmd.pushd("-q", "test/sample");
  shcmd.exec(command);
};

const clearPackages = () => {
  shcmd.cd("packages/pkg1");
  shcmd.rm("-rf", "node_modules");

  shcmd.cd("../pkg2");
  shcmd.rm("-rf", "node_modules");

  shcmd.popd("-q");
};

describe("test bootstrap command", () => {
  it("exec bootstrap", () => {
    execBootstrap();

    shcmd.cd("packages/pkg1");
    let files = shcmd.ls();
    expect(files).toContain("node_modules");

    shcmd.cd("../pkg2");
    files = shcmd.ls();
    expect(files).toContain("node_modules");

    shcmd.cd("../..");
    clearPackages();
  });
});
