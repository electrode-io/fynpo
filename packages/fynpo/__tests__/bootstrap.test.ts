import { describe, it, expect, beforeAll } from "@jest/globals";
import { Bootstrap } from "../src/bootstrap";
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
    const graph = new FynpoDepGraph({ cwd: path.join(__dirname, "../test/sample") });
    await graph.resolve();
    bootstrap = new Bootstrap(graph, parsed.opts);
  });

  it("should initialize bootstrap class", () => {
    expect(bootstrap._opts).toStrictEqual(parsed.opts);
    expect(bootstrap.failed).toEqual(0);
  });
});
