"use strict";

const Fs = require("fs");
const Path = require("path");
const _ = require("lodash");
const Yaml = require("js-yaml");
const Promise = require("bluebird");
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

describe("scenario", function() {
  let server;
  const saveExit = fyntil.exit;
  let registry;
  before(() => {
    fyntil.exit = code => {
      throw new Error(`exit ${code}`);
    };
    return mockNpm({ logLevel: "warn" }).then(s => {
      server = s;
      registry = `--reg=http://localhost:${server.info.port}`;
    });
  });

  after(done => {
    fyntil.exit = saveExit;
    server.stop(done);
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
    verify: _.noop
  };

  function executeScenario(cwd) {
    const pkgJsonFile = Path.join(cwd, "package.json");
    const pkgJson = {};
    const files = Fs.readdirSync(cwd).filter(x => x.startsWith("step-"));
    files.sort().forEach(step => {
      const stepDir = Path.join(cwd, step);
      const stepAction = optionalRequire(Path.join(stepDir), { default: {} });
      _.defaults(stepAction, nulStepAction);
      const stepTitle = stepAction.title ? `: ${stepAction.title}` : "";

      it(`${step}${stepTitle}`, () => {
        return Promise.try(() => stepAction.before())
          .then(() => {
            const pkg = readJson(Path.join(stepDir, "pkg.json"));
            _.merge(pkgJson, pkg);
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

            const args = [].concat(registry, BASE_ARGS, getFynDirArg(fynDir), [
              `--cwd=${cwd}`,
              "install"
            ]);

            return fynRun(args).catch(err => {
              if (err.message !== "exit 0") throw err;
            });
          })
          .then(() => {
            const nmTree = dirTree.make(cwd, "node_modules");
            const expectNmTree = Yaml.safeLoad(
              Fs.readFileSync(Path.join(stepDir, "nm-tree.yaml")).toString()
            );
            expect(nmTree).to.deep.equal(expectNmTree);
          })
          .then(() => stepAction.verify())
          .finally(() => stepAction.after());
      });
    });
  }

  const scenarioDir = Path.join(__dirname, "../scenarios");
  const scenarios = Fs.readdirSync(scenarioDir).filter(x => !x.startsWith("."));
  scenarios.sort().forEach(s => {
    describe(s, function() {
      const cwd = Path.join(scenarioDir, s);
      return executeScenario(cwd);
    });
  });
});
