/*
 * Test retrieving pkg dist during resolving to load npm-shrinkwrap.json
 */

const Fs = require("opfs");
const Path = require("path");
const assert = require("assert");

module.exports = {
  title: "should load npm-shrinkwrap from package's dist",
  timeout: 20000,
  getArgs(options) {
    return []
      .concat(options.baseArgs)
      .concat([
        `--reg=${options.registry}`,
        `--cwd=${options.cwd}`,
        `--fyn-dir=${options.fynDir}`,
        "stat",
        "mod-e",
        "mod-d"
      ])
      .filter(x => x);
  },
  async verify(cwd) {
    const debugLog = (await Fs.readFile(Path.join(cwd, "fyn-debug-step-02.log"))).toString();

    const text = `mod-e matched these installed versions mod-e@2.1.1
=> mod-e@2.1.1 has these dependents mod-b@1.0.0
> stat detected circular dependency: mod-b@1.0.0 mod-d@3.0.1 mod-b@1.0.0 mod-e@2.1.1
=> mod-e@2.1.1 has these dependency paths:
  > mod-ns@1.0.0 > mod-b@1.0.0 > mod-e@2.1.1
  > mod-ns@1.0.0 > mod-d@3.0.1 > mod-b@1.0.0 > mod-e@2.1.1
mod-d matched these installed versions mod-d@3.0.1
=> mod-d@3.0.1 has these dependents mod-b@1.0.0 mod-ns@1.0.0
> stat detected circular dependency: mod-d@3.0.1 mod-b@1.0.0 mod-d@3.0.1
=> mod-d@3.0.1 has these dependency paths:
  > mod-ns@1.0.0 > mod-b@1.0.0 > mod-d@3.0.1
  > mod-ns@1.0.0 > mod-d@3.0.1`;
    assert(debugLog.includes(text), "fyn-debug-step-02.log doesn't contain expected stat output");
  }
};
