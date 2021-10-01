import { describe, it, expect, beforeAll } from "@jest/globals";
import Bootstrap from "../src/bootstrap";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";

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

  let bootstrap;
  beforeAll(async () => {
    const graph = new FynpoDepGraph({ cwd: path.join(__dirname, "./sample") });
    await graph.resolve();
    bootstrap = new Bootstrap(graph, parsed.opts);
  });

  it("should initialize bootstrap class", () => {
    expect(bootstrap._opts).toStrictEqual(parsed.opts);
    expect(bootstrap.failed).toEqual(0);
  });

  it("should not add packages with pending dependencies", () => {
    const queue = bootstrap.getMoreInstall();
    expect(queue).toHaveLength(2);
    expect(queue[0].depData.pkgInfo.name).toStrictEqual("pkg2");
    expect(queue[1].depData.pkgInfo.name).toStrictEqual("pkg1");
  });
});
