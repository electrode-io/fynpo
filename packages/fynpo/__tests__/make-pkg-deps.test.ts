import { describe, it, expect } from "@jest/globals";
import makePkgDeps from "../src/make-pkg-deps";

describe("make package dependencies", () => {
  const packages = {
    pkg1: {
      name: "pkg1",
      version: "1.0.0",
      dependencies: {
        test1: "1.0.0",
      },
      devDependencies: {
        dev1: "1.0.0",
      },
      optionalDependencies: {
        opt1: "1.0.0",
      },
      peerDependencies: {
        peer1: "1.0.0",
      },
      localDeps: [],
      dependents: [],
      indirectDeps: [],
    },
    pkg2: {
      name: "pkg2",
      version: "1.0.0",
      dependencies: {
        pkg1: "1.0.0",
      },
      localDeps: [],
      dependents: [],
      indirectDeps: [],
    },
    pkg3: {
      name: "pkg3",
      version: "1.0.0",
      devDependencies: {
        pkg2: "1.0.0",
      },
      localDeps: [],
      dependents: [],
      indirectDeps: [],
    },
  };

  it("should set dependencies and dependents", () => {
    const { depMap } = makePkgDeps(packages, {});
    expect(depMap).toBeDefined;

    expect(depMap).toHaveProperty("pkg1");
    expect(depMap.pkg1.localDeps).toHaveLength(0);
    expect(depMap.pkg1.indirectDeps).toHaveLength(0);
    expect(depMap.pkg1.dependents).toEqual(["pkg2", "pkg3"]);

    expect(depMap).toHaveProperty("pkg2");
    expect(depMap.pkg2.localDeps).toEqual(["pkg1"]);
    expect(depMap.pkg2.indirectDeps).toHaveLength(0);
    expect(depMap.pkg2.dependents).toEqual(["pkg3"]);

    expect(depMap).toHaveProperty("pkg3");
    expect(depMap.pkg3.localDeps).toEqual(["pkg2"]);
    expect(depMap.pkg3.indirectDeps).toEqual(["pkg1"]);
    expect(depMap.pkg3.dependents).toHaveLength(0);
  });

  it("should ignore the ignore list of packages", () => {
    const packages = {
      pkg1: {
        name: "pkg1",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg2: {
        name: "pkg2",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg3: {
        name: "pkg3",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
    };
    const { packages: pkgs } = makePkgDeps(packages, { ignore: ["pkg3"] });
    expect(pkgs["pkg3"].ignore).toEqual(true);
    expect(pkgs["pkg1"].ignore).toBeUndefined;
    expect(pkgs["pkg2"].ignore).toBeUndefined;
  });

  it("should ignore the packages except the ones specified in only", () => {
    const packages = {
      pkg1: {
        name: "pkg1",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg2: {
        name: "pkg2",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg3: {
        name: "pkg3",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
    };
    const { packages: pkgs } = makePkgDeps(packages, { only: ["pkg3"] });

    expect(pkgs["pkg1"].ignore).toEqual(true);
    expect(pkgs["pkg2"].ignore).toEqual(true);
    expect(pkgs["pkg3"].ignore).toBeUndefined;
  });

  it("should ignore the packages without the specified scope", () => {
    const packages = {
      "@test/pkg1": {
        name: "@test/pkg1",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg2: {
        name: "pkg2",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg3: {
        name: "pkg3",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
    };
    const { packages: pkgs } = makePkgDeps(packages, { scope: ["@test"] });

    expect(pkgs["@test/pkg1"].ignore).toBeUndefined;
    expect(pkgs["pkg2"].ignore).toEqual(true);
    expect(pkgs["pkg3"].ignore).toEqual(true);
  });

  it("should set ignore false if included as local dependency", () => {
    const packages = {
      pkg1: {
        name: "pkg1",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg2: {
        name: "pkg2",
        dependencies: {
          pkg1: "1.0.0",
        },
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
      pkg3: {
        name: "pkg3",
        localDeps: [],
        dependents: [],
        indirectDeps: [],
      },
    };
    const { packages: pkgs } = makePkgDeps(packages, { deps: 2, ignore: ["pkg1", "pkg3"] });

    expect(pkgs["pkg1"].ignore).toEqual(false);
    expect(pkgs["pkg3"].ignore).toEqual(true);
  });
});
