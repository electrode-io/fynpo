import { describe, it, expect } from "@jest/globals";
import { processInput, processOutput } from "../src/caching";
import npmPacklist from "npm-packlist";
import _ from "lodash";

describe("caching", function () {
  const getInput = async () => {
    const files = await processInput({
      cwd: process.cwd(),
      input: {
        npmScripts: ["prepare", "prepublish", "build:release", "build"],
        include: ["**/*"],
        exclude: [
          "**/?(node_modules|.vscode|.DS_Store|coverage|.nyc_output|.fynpo|.git|.github|.gitignore|docs|docusaurus|packages|tmp|.etmp|samples|dist|dist-*|build)",
          "**/*.?(log|md)",
          "**/*test*/*",
          "**/*.?(test|spec).*",
        ],
        includeEnv: ["NODE_ENV"],
      },
    });

    return files;
  };
  it("should create input data", async () => {
    const b = Date.now();
    const files = await getInput();
    const e = Date.now();
    console.log(files, "\n", e - b);
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
    console.log(output, "\n", e - b);
    const outputFiles = _.groupBy(output.files, (x: string) =>
      input.data.fileHashes[x] ? "both" : "output"
    );
    console.log(outputFiles);
  });
});
