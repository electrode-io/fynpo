"use strict";

/* eslint-disable complexity */

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const Yaml = require("js-yaml");
const Promise = require("bluebird");
const rimraf = require("rimraf");
const dirTree = require("../dir-tree");
const fynRun = require("../../cli/fyn");
const fyntil = require("../../lib/util/fyntil");
const logger = require("../../lib/logger");
const mockNpm = require("../fixtures/mock-npm");
const optionalRequire = require("optional-require")(require);
const sortObjKeys = require("../../lib/util/sort-obj-keys");
const ci = require("ci-info");

const BASE_ARGS = ["--pg=none", "-q=none", "--no-rcfile"];
const getFynDirArg = dir => `--fyn-dir=${dir}`;

function readJson(path) {
  try {
    return JSON.parse(Fs.readFileSync(path).toString());
  } catch (e) {
    return false;
  }
}

const debug = false;

(debug ? describe.only : describe)("scenario", function() {
  let server;
  const saveExit = fyntil.exit;
  let registry;
  let saveCI;
  before(() => {
    saveCI = ci.isCI;
    ci.isCI = false;
    fyntil.exit = code => {
      throw new Error(`exit ${code}`);
    };
    return mockNpm({ port: 0, logLevel: "warn" }).then(s => {
      server = s;
      registry = `http://localhost:${server.info.port}`;
    });
  });

  after(() => {
    ci.isCI = saveCI;
    fyntil.exit = saveExit;
    return server.stop();
  });

  beforeEach(() => {
    logger._items = [];
    logger._itemOptions = {};
    logger._lines = [];
    logger._logData = [];
  });

  const nulStepAction = {
    before: _.noop,
    after: _.noop,
    verify: _.noop,
    extraArgs: []
  };

  function executeScenario(scenarioDir, options) {
    const cleanLock = lock => {
      _.each(lock, (pkg, name) => {
        if (name.startsWith("$")) return;
        _.each(pkg, (vpkg, ver) => {
          if (ver.startsWith("_")) return;
          vpkg.$ = "test";
          vpkg._ = vpkg._.replace(/:[0-9]+\//, "/");
        });
      });

      return lock;
    };

    const verifyLock = (_cwd, stepDir) => {
      const expectLockFile = Path.join(stepDir, "lock.yaml");
      if (Fs.existsSync(expectLockFile)) {
        const actualLockFile = Path.join(_cwd, "fyn-lock.yaml");
        const expectLock = Yaml.safeLoad(Fs.readFileSync(expectLockFile).toString());
        const actualLock = Yaml.safeLoad(Fs.readFileSync(actualLockFile).toString());
        expect(cleanLock(actualLock), "lock file should match").to.deep.equal(
          cleanLock(expectLock)
        );
      }
    };

    const deleteNullFields = obj => {
      _.each(obj, (v, k) => {
        if (v === null || v === undefined) {
          delete obj[k];
        } else if (v && v.constructor.name === "Object") {
          deleteNullFields(v);
        }
      });
    };
    const accumulatedPkgJson = {};

    const makeStep = step => {
      const stepDir = Path.join(scenarioDir, step);
      const stepAction = optionalRequire(Path.join(stepDir), { default: {} });

      _.defaults(stepAction, nulStepAction);

      const cwd = stepAction.pkgDir ? Path.join(scenarioDir, stepAction.pkgDir) : scenarioDir;

      const stepTitle = stepAction.title ? `: ${stepAction.title}` : "";
      let failError;

      //
      // remove existing debug log file for step
      //
      const debugLogFile = `fyn-debug-${step}.log`;
      rimraf.sync(Path.join(cwd, debugLogFile));

      const testCase = (stepAction.skip ? it.skip : it)(`${step}${stepTitle}`, () => {
        if (debug && step === options.debugStep) {
          debugger; // eslint-disable-line
        }
        return Promise.try(() => stepAction.before(cwd, scenarioDir))
          .then(() => {
            const stepLockFile = Path.join(stepDir, "lock.yaml");
            if (stepAction.copyLock && Fs.existsSync(stepLockFile)) {
              const lockData = Fs.readFileSync(stepLockFile);
              Fs.writeFileSync(Path.join(cwd, "fyn-lock.yaml"), lockData);
            }
          })
          .then(() => {
            const pkgJsonFile = Path.join(cwd, "package.json");
            const pkg = readJson(Path.join(stepDir, "pkg.json"));
            if (pkg) {
              _.merge(accumulatedPkgJson, pkg);
              [
                "dependencies",
                "devDependencies",
                "optionalDependencies",
                "peerDependencies"
              ].forEach(k => {
                if (accumulatedPkgJson[k]) {
                  accumulatedPkgJson[k] = sortObjKeys(accumulatedPkgJson[k]);
                }
              });
              deleteNullFields(accumulatedPkgJson);
              Fs.writeFileSync(pkgJsonFile, `${JSON.stringify(accumulatedPkgJson, null, 2)}\n`);
            }
            const fynDir = Path.join(scenarioDir, ".fyn");
            if (stepAction.run) {
              return stepAction.run({
                registry,
                fynDir,
                cwd: cwd,
                baseArgs: BASE_ARGS,
                pkgJson: accumulatedPkgJson,
                pkgJsonFile,
                debug
              });
            }

            let args;

            if (stepAction.getArgs) {
              args = stepAction.getArgs({
                registry,
                fynDir,
                cwd: cwd,
                baseArgs: []
                  .concat(BASE_ARGS)
                  .concat(`--sl`, debugLogFile, (debug && ["-q", "debug"]) || []),
                pkgJson: accumulatedPkgJson,
                pkgJsonFile,
                debug
              });
              if (!args.find(x => x.includes("--cwd"))) {
                args = args.concat(`--cwd=${cwd}`);
              }
            } else {
              args = [].concat(
                `--reg=${registry}`,
                BASE_ARGS,
                stepAction.buildLocal ? "--build-local" : "--no-build-local",
                `--layout=detail`,
                `--source-maps`,
                `--sl`,
                debugLogFile,
                getFynDirArg(fynDir),
                stepAction.extraArgs,
                (debug && ["-q", "debug"]) || [],
                [`--cwd=${cwd}`, "install"],
                stepAction.forceInstall === false ? "" : "--fi"
              );
            }

            if (debug) {
              console.log(
                "scenario running fyn with args",
                args.filter(x => x)
              );
            }

            return fynRun(args.filter(x => x)).catch(err => {
              if (err.message !== "exit 0") failError = err;
            });
          })
          .then(() => {
            if (stepAction.expectFailure) {
              if (!failError) {
                throw new Error("step has expectFailure hook but no failure captured");
              }
              stepAction.expectFailure(failError);
            } else if (failError) {
              throw failError;
            }

            const nmTree = dirTree.make(cwd, "node_modules");
            if (debug) {
              console.log(`directory node_modules tree:\n${Yaml.dump(nmTree, 2)}`);
            }

            const expectNmTree = Yaml.safeLoad(
              Fs.readFileSync(Path.join(stepDir, "nm-tree.yaml")).toString()
            );
            expect(nmTree).to.deep.equal(expectNmTree);
            verifyLock(cwd, stepDir);
          })
          .catch(err => {
            if (!debug) {
              const msg = `scenario test "${step}${stepTitle}" failed`;
              try {
                const logs = Fs.readFileSync(Path.join(cwd, debugLogFile)).toString();
                console.log(`
+===============================================
| ${msg}
| ${debugLogFile} follows:
+-----------------------------------------------`);

                console.log(logs);
                console.log("\n");
                console.log(err);
              } catch (err2) {
                console.log(`
+===============================================
| ${msg}, but no ${debugLogFile} found
| Error: ${err2.message}
+-----------------------------------------------`);
              }
            }
            throw err;
          })
          .then(() => stepAction.verify(cwd, scenarioDir))
          .delay(10)
          .finally(() => stepAction.after());
      });

      if (debug) testCase.timeout(10000000);
      else if (stepAction.timeout) testCase.timeout(stepAction.timeout);
    };

    const files = Fs.readdirSync(scenarioDir).filter(x => x.startsWith("step-"));

    for (const step of files.sort()) {
      makeStep(step);
      if (step === options.stopStep) break;
    }
  }

  const cleanUp = !debug;
  const filter = debug
    ? {
        // "add-remove-pkg": { stopStep: "step-02", debugStep: "step-02" }
        // "auto-deep-resolve": {}
        // "bin-linker": {}
        // "build-local": {}
        // "fyn-central": {},
        "fynpo-sample": { stopStep: "step-01" }
        // "fyn-shrinkwrap": {}
        // "local-hard-linking": {}
        // "local-sym-linking": {}
        // "locked-change-major": {}
        // "locked-change-dedupe": { debugStep: "step-02" }
        // "locked-change-dedupe-2": { debugStep: "step-02" }
        // "locked-npm-dedupe": {}
        // "locked-change-indirect": {}
        // "missing-peer-dep": {}
        // "nested-dep": {}
        // "npm-shrinkwrap": {}
        // "optional-check": {}
        // "package-fyn": {}
        // "platform-check": {}
        // "platform-check-good": {}
        // "remote-url-semver": {}
        // "stat-pkg": {}
      }
    : {};

  const saveCwd = process.cwd();
  const scenarioDir = Path.join(__dirname, "../scenarios");
  const scenarios = Fs.readdirSync(scenarioDir).filter(x => !x.startsWith("."));
  scenarios.sort().forEach(s => {
    if (_.isEmpty(filter) || filter[s]) {
      const f = filter[s] || {};
      describe(s, function() {
        const cwd = Path.join(scenarioDir, s);
        const clean = () => {
          rimraf.sync(Path.join(cwd, "package.json"));
          rimraf.sync(Path.join(cwd, "fyn-lock.yaml"));
          rimraf.sync(Path.join(cwd, ".fyn"));
          rimraf.sync(Path.join(cwd, "node_modules"));
        };

        before(clean);

        if (cleanUp) {
          after(clean);
        }

        afterEach(() => {
          process.chdir(saveCwd);
        });

        return executeScenario(cwd, f);
      });
    }
  });
});
