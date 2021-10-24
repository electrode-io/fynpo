import { describe, it, expect, beforeAll } from "@jest/globals";
import { TopoRunner } from "../src/topo-runner";
import path from "path";
import { FynpoDepGraph } from "@fynpo/base";

describe("fynpo topo-runner", () => {
  const dir = path.join(__dirname, "sample");
  const parsed = {
    name: "test",
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

  let runner;
  beforeAll(async () => {
    const graph = new FynpoDepGraph({ cwd: path.join(__dirname, "./sample") });
    await graph.resolve();
    runner = new TopoRunner(graph.getTopoSortPackages(), parsed.opts);
  });

  it("should not add packages with pending dependencies", () => {
    const queue = runner.getMore();
    expect(queue).toHaveLength(2);
    expect(queue[0].depData.pkgInfo.name).toStrictEqual("pkg2");
    expect(queue[1].depData.pkgInfo.name).toStrictEqual("pkg1");
  });
});
