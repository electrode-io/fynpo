import { describe, it, expect, afterAll } from "@jest/globals";
import { loadConfig } from "../src/utils";
import path from "path";
import fs from "fs";
import shcmd from "shcmd";

describe("loadConfig", () => {
  const dir = path.join(__dirname, "sample");

  afterAll(() => {
    shcmd.rm(path.join(dir, "fynpo.json"));
  });

  const makeConfigFile = (fileName, data) => {
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data));
  };

  it("should load lerna config", () => {
    makeConfigFile("lerna.json", { fynpo: true });

    const config: any = loadConfig(dir);
    expect(config.fynpoRc).toHaveProperty("fynpo");
    expect(config.fynpoRc.fynpo).toEqual(true);
  });

  it("should load fynpo config", () => {
    makeConfigFile("fynpo.json", { test: "123" });

    const config: any = loadConfig(dir);
    expect(config.fynpoRc).toHaveProperty("test");
    expect(config.fynpoRc.test).toEqual("123");
  });
});
