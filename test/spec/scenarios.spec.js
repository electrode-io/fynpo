"use strict";

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

const BASE_ARGS = ["--pg=none", "-q=none", "--no-rcfile"];
const getFynDirArg = dir => `--fyn-dir=${dir}`;

function readJson(path) {
  try {
    return JSON.parse(Fs.readFileSync(path).toString());
  } catch (e) {
    return {};
  }
}

const debug = false;

(debug ? describe.only : describe)("scenario", function() {
  let server;
  const saveExit = fyntil.exit;
  let registry;
  before(() => {
    fyntil.exit = code => {
      throw new Error(`exit ${code}`);
    };
    return mockNpm({ port: 0, logLevel: "warn" }).then(s => {
      server = s;
      registry = `http://localhost:${server.info.port}`;
    });
  });

  after(() => {
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

  function executeScenario(cwd, options) {
    const stopStep = options.stopStep;
    const debugStep = options.debugStep;
    const pkgJsonFile = Path.join(cwd, "package.json");
    const pkgJson = {};
    const files = Fs.readdirSync(cwd).filter(x => x.startsWith("step-"));

    const cleanLock = lock => {
      _.each(lock, pkg => {
        _.each(pkg, (vpkg, ver) => {
          if (ver.startsWith("_")) return;
          vpkg.$ = "test";
          vpkg._ = vpkg._.replace(/:[0-9]+\//, "/");
        });
      });

      return lock;
    };

    const verifyLock = stepDir => {
      const expectLockFile = Path.join(stepDir, "lock.yaml");
      if (Fs.existsSync(expectLockFile)) {
        const actualLockFile = Path.join(cwd, "fyn-lock.yaml");
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

    const makeStep = step => {
      const stepDir = Path.join(cwd, step);
      const stepAction = optionalRequire(Path.join(stepDir), { default: {} });
      _.defaults(stepAction, nulStepAction);
      const stepTitle = stepAction.title ? `: ${stepAction.title}` : "";
      let failError;

      const testCase = (stepAction.skip ? it.skip : it)(`${step}${stepTitle}`, () => {
        if (debug && step === debugStep) {
          debugger; // eslint-disable-line
        }
        return Promise.try(() => stepAction.before(cwd))
          .then(() => {
            const pkg = readJson(Path.join(stepDir, "pkg.json"));
            _.merge(pkgJson, pkg);
            deleteNullFields(pkgJson);
            Fs.writeFileSync(pkgJsonFile, JSON.stringify(pkgJson, null, 2));

            const fynDir = Path.join(cwd, ".fyn");
            if (stepAction.run) {
              return stepAction.run({
                registry,
                fynDir,
                cwd,
                baseArgs: BASE_ARGS,
                pkgJson,
                pkgJsonFile
              });
            }

            const args = [].concat(
              `--reg=${registry}`,
              BASE_ARGS,
              getFynDirArg(fynDir),
              stepAction.extraArgs,
              (debug && ["-q", "debug"]) || [],
              [`--cwd=${cwd}`, "install"]
            );

            return fynRun(args).catch(err => {
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
            verifyLock(stepDir);
          })
          .catch(err => {
            if (!debug) {
              const msg = `scenario test "${step}${stepTitle}" failed`;
              try {
                const logs = Fs.readFileSync(Path.join(cwd, "fyn-debug.log")).toString();
                console.log(`${msg}, fyn-debug.log follows:`);
                console.log(logs);
              } catch (err2) {
                console.log(`${msg}, but no fyn-debug.log found:`, err2.message);
              }
            }
            throw err;
          })
          .then(() => stepAction.verify())
          .finally(() => stepAction.after());
      });

      if (debug) testCase.timeout(10000000);
      else if (stepAction.timeout) testCase.timeout(stepAction.timeout);
    };

    for (const step of files.sort()) {
      makeStep(step);
      if (step === stopStep) break;
    }
  }

  const cleanUp = !debug;
  const filter = debug
    ? {
        // "auto-deep-resolve": {}
        // "bin-linker": {}
        // "fyn-shrinkwrap": {}
        // "local-hard-linking": {}
        // "local-sym-linking": {}
        // "locked-change-major": { stopStep: "step-01" }
        // "missing-peer-dep": {}
        // "nested-dep": {}
        // "npm-shrinkwrap": {}
        "optional-check": {}
        // "package-fyn": {}
        // "platform-check": {}
        // "platform-check-good": {}
        // "remote-url-semver": {}
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
