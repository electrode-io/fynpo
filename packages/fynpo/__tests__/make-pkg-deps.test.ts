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
    const { depMap, ignores } = makePkgDeps(packages, [], ["pkg1", "pkg2"]);
    expect(depMap).toBeDefined;
    expect(ignores).toBeDefined;
    expect(ignores).toEqual(["pkg3"]);

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
});
