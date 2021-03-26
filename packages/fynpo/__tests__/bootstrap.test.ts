import { describe, it, expect, beforeAll } from "@jest/globals";
import Bootstrap from "../src/bootstrap";
import path from "path";

describe("fynpo bootstrap", () => {
  const dir = path.join(__dirname, "sample");
  const parsed = {
    name: "bootstrap",
    opts: {
      cwd: dir,
      deps: 10,
      saveLog: false,
      tag: true,
      build: true,
      concurrency: 3,
    },
    args: {},
    argList: [],
  };

  const pkgDeps = {
    packages: {
      pkg1: {
        name: "pkg1",
        version: "1.0.0",
        path: path.join(dir, "packages/pkg1/package.json"),
        localDeps: [],
      },
      pkg2: {
        name: "pkg2",
        version: "1.0.0",
        path: path.join(dir, "packages/pkg2/package.json"),
        localDeps: ["pkg1"],
      },
      pkg3: {
        name: "pkg3",
        version: "1.0.0",
        path: path.join(dir, "packages/pkg3/package.json"),
        localDeps: ["pkg2"],
      },
      pkg4: {
        name: "pkg4",
        version: "1.0.0",
        path: path.join(dir, "packages/pkg4/package.json"),
        localDeps: [],
      },
    },
    circulars: [],
  };

  let bootstrap;
  beforeAll(() => {
    bootstrap = new Bootstrap(pkgDeps, parsed.opts);
  });

  it("should initialize bootstrap class", () => {
    expect(bootstrap._data).toStrictEqual(pkgDeps);
    expect(bootstrap._opts).toStrictEqual(parsed.opts);
    expect(bootstrap.failed).toEqual(0);
  });

  it("should descope package name", () => {
    expect(bootstrap.descopePkgName("@walmart/abc")).toStrictEqual("abc");
    expect(bootstrap.descopePkgName("test")).toStrictEqual("test");
  });

  it("should not add packages with pending dependencies", () => {
    bootstrap._data = {
      packages: {
        pkg1: {
          name: "pkg1",
          localDeps: ["pkg5"],
        },
        pkg2: {
          name: "pkg2",
          localDeps: ["pkg1"],
        },
        pkg3: {
          name: "pkg3",
          localDeps: [],
          installed: "pending",
        },
        pkg4: {
          name: "pkg4",
          localDeps: [],
          ignore: true,
        },
        pkg5: {
          name: "pkg5",
          localDeps: [],
          installed: true,
        },
      },
    };
    const queue = bootstrap.getMoreInstall();
    expect(queue).toHaveLength(1);
    expect(queue[0].name).toStrictEqual("pkg1");
  });
});
