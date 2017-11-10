"use strict";

const LifecycleScripts = require("../../lib/lifecycle-scripts");
const Path = require("path");
const xstdout = require("xstdout");

describe("lifecycle-scripts", function() {
  const failRestore = (err, stdout) => {
    stdout.restore();
    console.log(stdout.stdout);
    console.log(stdout.stderr);
    throw err;
  };

  it("should execute a script from package.json", () => {
    const stdout = xstdout.intercept(true);
    const promise = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f1"))
      .execute("test")
      .then(() => {
        stdout.restore();
        expect(stdout.stdout.indexOf("hello") >= 0);
      })
      .catch(err => failRestore(err, stdout));

    return promise;
  });

  it("should set vars from config in package.json", () => {
    const stdout = xstdout.intercept(true);
    const promise = new LifecycleScripts(Path.join(__dirname, "../fixtures/lifecycle-scripts/f3"))
      .execute("test")
      .then(() => {
        stdout.restore();
        expect(stdout.stdout.indexOf("foo-bar") >= 0);
      })
      .catch(err => failRestore(err, stdout));

    return promise;
  });

  it("should not execute a script not in package.json", () => {
    const promise = new LifecycleScripts({
      pkgDir: Path.join(__dirname, "../fixtures/lifecycle-scripts/f2")
    })
      .execute("test")
      .then(x => {
        expect(x).to.equal(false);
      });

    return promise;
  });
});
