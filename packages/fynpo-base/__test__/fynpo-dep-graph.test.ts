import { describe, it, expect } from "@jest/globals";
import { FynpoDepGraph, getDepSection } from "../src";
import path from "path";
import Fs from "fs";

describe("getDepSection", function () {
  it("should return dep for dependencies", () => {
    expect(getDepSection("dependencies")).toEqual("dep");
  });

  it("should default to dep", () => {
    expect(getDepSection("")).toEqual("dep");
  });
});

describe("fynpo dep graph", () => {
  it.only("should read only packages matching patterns in CWD", async () => {
    const saveDir = process.cwd();
    process.chdir(path.join(__dirname, "sample"));
    const graph = new FynpoDepGraph({ patterns: ["packages/*"] });
    await graph.resolve();
    process.chdir(saveDir);
    const paths = Object.keys(graph.packages.byPath);
    expect(paths.every((p) => p.startsWith("packages/"))).toEqual(true);
  });

  it("should read all packages when patterns is empty", async () => {
    const graph1 = new FynpoDepGraph({
      patterns: null,
      cwd: path.join(__dirname, "sample"),
    });
    await graph1.resolve();
    const topoSorted1 = JSON.stringify(graph1.getTopoSortPackages());
    await graph1.resolve();
    const topoSorted2 = JSON.stringify(graph1.getTopoSortPackages());
    expect(topoSorted1).toEqual(topoSorted2);

    const graph2 = new FynpoDepGraph({
      patterns: ["@scope/*", "packages/**", "test1", "tests/**"],
      cwd: path.join(__dirname, "sample"),
    });

    await graph2.resolve();
    const topo = graph2.getTopoSortPackages();
    const topoSorted3 = JSON.stringify(topo);
    expect(topoSorted3).toEqual(topoSorted2);

    const expectFile = path.join(__dirname, "sample-topo.json");

    const expectData = JSON.parse(Fs.readFileSync(expectFile, "utf-8"));

    expect(topo).toEqual(expectData);

    // Fs.writeFileSync(expectFile, JSON.stringify(graph1.getTopoSortPackages(), null, 2));
  });

  it("should read packages of the electrode project", async () => {
    const graph = new FynpoDepGraph({
      cwd: path.join(__dirname, "electrode"),
    });
    await graph.resolve();
    const topo = graph.getTopoSortPackages();

    const expectFile = path.join(__dirname, "electrode-topo.json");

    // Fs.writeFileSync(expectFile, JSON.stringify(graph.getTopoSortPackages(), null, 2));

    const expectData = JSON.parse(Fs.readFileSync(expectFile, "utf-8"));
    expect(topo).toEqual(expectData);
  });

  it("should resolvePackage by name and semver", async () => {
    const graph = new FynpoDepGraph({
      cwd: path.join(__dirname, "electrode"),
    });
    await graph.resolve();
    const r1 = graph.resolvePackage("@xarc/app", "^10.0.0");
    expect(r1).toHaveProperty("name", "@xarc/app");

    graph.addPackage(
      { name: "@xarc/app", version: "11.1.5" },
      path.join(path.dirname(r1.path), "xarc-app-11")
    );

    graph.updateAuxPackageData();

    const r2 = graph.resolvePackage("@xarc/app", "^11.0.0");
    expect(r2).toHaveProperty("name", "@xarc/app");
    expect(r2).toHaveProperty("version", "11.1.5");

    const r3 = graph.resolvePackage("@xarc/app", "^12.0.0");
    expect(r3).toHaveProperty("name", "@xarc/app");
    expect(r3).toHaveProperty("version", "11.1.5");

    const r4 = graph.resolvePackage("blahblah", "^1.0.0");
    expect(r4).toEqual(undefined);
  });

  it("addDepByPath should add dependency", async () => {
    const graph = new FynpoDepGraph({
      patterns: null,
      cwd: path.join(__dirname, "sample"),
    });
    await graph.readPackages();
    await graph.resolve();
    const topoSorted1 = JSON.stringify(graph.getTopoSortPackages());
    const paths = Object.keys(graph.packages.byPath);
    graph.addDepByPath(paths[0], paths[1], "dep");

    const topoSorted2 = JSON.stringify(graph.getTopoSortPackages());
    expect(topoSorted1).not.toEqual(topoSorted2);
  });

  it("addDepById should add dependency", async () => {
    const graph = new FynpoDepGraph({
      patterns: null,
      cwd: path.join(__dirname, "sample"),
    });
    await graph.readPackages();
    await graph.resolve();
    const topoSorted1 = JSON.stringify(graph.getTopoSortPackages());
    const ids = Object.keys(graph.packages.byId);
    graph.addDepById(ids[0], ids[1], "dep");
    // test adding again
    graph.addDepById(ids[0], ids[1], "dep");

    const topoSorted2 = JSON.stringify(graph.getTopoSortPackages());
    expect(topoSorted1).not.toEqual(topoSorted2);
  });

  it("addDepByPath/addDepById should handle non-existent path/id", async () => {
    const graph = new FynpoDepGraph({
      patterns: null,
      cwd: path.join(__dirname, "sample"),
    });
    await graph.resolve();
    const topoSorted1 = JSON.stringify(graph.getTopoSortPackages());
    // both non-existent
    graph.addDepByPath("blahblah", "blahblah2", "dep");
    graph.addDepById("blahblah", "blahblah2", "dep");
    // only dep non-existent
    graph.addDepByPath(Object.keys(graph.packages.byPath)[0], "blahblah2", "dep");
    graph.addDepById(Object.keys(graph.packages.byId)[0], "blahblah2", "dep");

    await graph.resolve();
    const topoSorted2 = JSON.stringify(graph.getTopoSortPackages());
    expect(topoSorted1).toEqual(topoSorted2);
  });
});
