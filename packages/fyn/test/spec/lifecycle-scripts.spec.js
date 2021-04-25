"use strict";

const LifecycleScripts = require("../../lib/lifecycle-scripts");
const Path = require("path");
const xstdout = require("xstdout");
const logger = require("../../lib/logger");
const chalk = require("chalk");

describe("lifecycle-scripts", function() {
  logger.setItemType(false);
  chalk.level = 0;

  beforeEach(() => {
    logger._logLevel = 0;
  });

  const failRestore = (err, intercept) => {
    intercept.restore();
    console.log(intercept.stdout);
    console.log(intercept.stderr);
    throw err;
  };

  const extractOutput = intercept => {
    let output = intercept.stdout.find(x => x.indexOf(">>> Start of output") >= 0).split("\n");
    output = output
      .slice(1, output.length - 1)
      .map(x => x.trim())
      .filter(x => x);
    const ix1 = output.indexOf("=== stderr ===");
    const stdout = output.slice(0, ix1);
    const stderr = output.slice(ix1 + 1, output.length - 1);

    return { stdout, stderr };
  };

  it("should execute a script from package.json", () => {
    const intercept = xstdout.intercept(true);
    const promise = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f1"))
      .execute(["test"])
      .then(() => {
        intercept.restore();
        expect(intercept.stdout[2].trim()).to.equal("hello");
      })
      .catch(err => failRestore(err, intercept));

    return promise;
  });

  it("should silently execute a script from package.json", () => {
    const intercept = xstdout.intercept(true);
    const promise = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f1"))
      .execute("test1", true)
      .then(() => {
        intercept.restore();
        const output = extractOutput(intercept);
        expect(output.stdout[0]).to.equal("hello");
        expect(output.stderr[0]).to.equal("stderr foo");
      })
      .catch(err => failRestore(err, intercept));

    return promise;
  });

  it("should silently execute a script with empty output from package.json", () => {
    const intercept = xstdout.intercept(true);
    const promise = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f1"))
      .execute("test4", true)
      .then(() => {
        intercept.restore();
        const output = extractOutput(intercept);
        expect(output.stdout).to.be.empty;
        expect(output.stderr).to.be.empty;
      })
      .catch(err => failRestore(err, intercept));

    return promise;
  });

  it("should silently execute a fail script from package.json", () => {
    let error;
    const intercept = xstdout.intercept(true);
    const promise = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f1"))
      .execute("test3", true)
      .catch(err => {
        intercept.restore();
        error = err;
      })
      .then(() => {
        intercept.restore();
        expect(error).to.exist;
        const output = extractOutput(intercept);
        expect(output.stdout).to.be.empty;
        expect(output.stderr[0]).to.equal("stderr blah");
        expect(error.message).includes("exit code 127");
      });

    return promise;
  });

  it("should silently execute a script with no output from package.json", () => {
    const intercept = xstdout.intercept(true);
    const promise = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f1"))
      .execute("test2", true)
      .then(() => {
        intercept.restore();
        expect(intercept.stdout[3].trim()).to.equal("> No output from f1@1.0.0 npm script test2");
      })
      .catch(err => failRestore(err, intercept));

    return promise;
  });

  it("should set vars from config in package.json", () => {
    const intercept = xstdout.intercept(true);
    const ls = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f3"));
    const promise = ls
      .execute("test", true)
      .then(() => {
        intercept.restore();
        const output = extractOutput(intercept);
        expect(output.stdout).includes("foo-bar");
      })
      .catch(err => failRestore(err, intercept));

    return promise;
  });

  it("should not execute a script not in package.json", () => {
    const promise = new LifecycleScripts({
      dir: Path.join(__dirname, "../fixtures/lifecycle-scripts/f2")
    })
      .execute("test")
      .then(x => {
        expect(x).to.equal(false);
      });

    return promise;
  });
});
