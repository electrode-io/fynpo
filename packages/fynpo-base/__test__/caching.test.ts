import { describe, it, expect } from "@jest/globals";
import { processInput, processOutput } from "../src/caching";
import npmPacklist from "npm-packlist";
import _ from "lodash";

describe("caching", function () {
  const getInput = async () => {
    return await processInput({
      cwd: process.cwd(),
      input: {
        npmScripts: ["prepare", "prepublish", "build:release", "build"],
        include: ["**/src/**", "package.json", "**/*test*/**"],
        exclude: [
          "**/?(node_modules|.vscode|.DS_Store|coverage|.nyc_output|.fynpo|.git|.github|.gitignore|docs|docusaurus|packages|tmp|.etmp|samples|dist|dist-*|build)",
          "**/*.?(log|md)",
          "**/*test*/*",
          "**/*.?(test|spec).*",
        ],
        includeEnv: ["NODE_ENV"],
      },
    });
  };

  it("should create input data", async () => {
    const b = Date.now();
    const res = await getInput();
    const e = Date.now();

    const r = _.uniq(res.files.map((f) => f.split("/")[0])).sort();
    expect(r).toStrictEqual(["package.json", "src"]);

    console.log(res, "\n", e - b);
  });

  it("should create output files with result from npm pack list", async () => {
    const input = await getInput();
    const b = Date.now();
    const preFiles = await npmPacklist({
      path: process.cwd(),
    });
    const output = await processOutput({
      cwd: process.cwd(),
      inputHash: "deadbeef",
      output: {
        include: [],
        filesFromNpmPack: true,
        exclude: [
          "**/?(node_modules|.vscode|.DS_Store|coverage|.nyc_output|.fynpo|.git|.github|.gitignore|docs|docusaurus|packages|tmp|.etmp|samples)",
          "**/*.?(log|md)",
          "**/*test*/*",
          "**/*.?(test|spec).*",
        ],
      },
      preFiles,
    });
    const e = Date.now();
    console.log("output", output, "\n", e - b);
    const outputFiles = _.groupBy(output.files, (x: string) =>
      input.data.fileHashes[x] ? "both" : "output"
    );
    console.log("outputFiles", outputFiles);
  });
});
