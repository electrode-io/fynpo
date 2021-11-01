import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import Prepare from "../src/prepare";
import path from "path";
import fs from "fs";
import shcmd from "shcmd";

describe("fynpo prepare", () => {
  const dir = path.join(__dirname, "../test/sample");
  const data = {
    packages: {
      pkg1: {
        name: "pkg1",
        version: "1.0.0",
        path: path.join(dir, "packages/pkg1/package.json"),
      },
      pkg2: {
        name: "pkg2",
        version: "1.0.0",
        path: path.join(dir, "packages/pkg2/package.json"),
      },
    },
  };

  const fynpoConfigFile = path.join(dir, "fynpo.json");
  let prepare;
  beforeAll(() => {
    fs.writeFileSync(fynpoConfigFile, "{}\n");
    prepare = new Prepare({ cwd: dir, tag: true }, data);
  });

  afterAll(() => {
    shcmd.rm("-f", fynpoConfigFile);
  });

  it("should initialize prepare class", () => {
    expect(prepare._data).toStrictEqual(data);
    expect(prepare._cwd).toStrictEqual(dir);
  });

  it("should update dependencies", () => {
    const pkg = {
      dependencies: {
        test: "1.0.0",
        test1: "2.1.0",
      },
    };
    prepare.updateDep(pkg, "test", "1.0.2");
    expect(pkg.dependencies.test).toEqual("1.0.2");
  });

  it("should set tag in publish config", () => {
    prepare._fynpoRc = {
      command: {
        publish: {
          tags: {
            next: {
              packages: {
                pkg1: {},
              },
            },
          },
        },
      },
    };

    const pkg = {
      pkgJson: {
        name: "pkg1",
        version: "2.0.0",
        publishConfig: {
          tag: "latest",
        },
      },
    };
    prepare._checkNupdateTag(pkg, "3.0.0");
    expect(pkg.pkgJson.version).toEqual("3.0.0");
    expect(pkg.pkgJson.publishConfig.tag).toEqual("next");
  });

  it("should set versionTagging as tag in publish config", () => {
    prepare._fynpoRc = {
      command: {
        publish: {
          versionTagging: {
            pkg1: {},
          },
        },
      },
    };

    const pkg = {
      pkgJson: {
        name: "pkg1",
        version: "2.0.0",
        publishConfig: {
          tag: "latest",
        },
      },
    };
    prepare._checkNupdateTag(pkg, "3.0.1");
    expect(pkg.pkgJson.version).toEqual("3.0.1");
    expect(pkg.pkgJson.publishConfig.tag).toEqual("ver3");
  });

  it("read changelog", () => {
    prepare.readChangelog();
    expect(prepare._tags).toStrictEqual(["pkg1@3.0.1", "pkg2@2.0.0"]);
    expect(prepare._versions).toStrictEqual({ pkg1: "3.0.1", pkg2: "2.0.0" });
  });
});
