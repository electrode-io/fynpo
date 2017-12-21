"use strict";

const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const Fyn = require("../../lib/fyn");
const mockNpm = require("../fixtures/mock-npm");
const expect = require("chai").expect;
const _ = require("lodash");
const rimraf = require("rimraf");
const logger = require("../../lib/logger");
const chalk = require("chalk");

describe("pkg-dep-resolver", function() {
  logger.logItem(false);
  chalk.enabled = false;
  let server;
  let fynDir;
  before(() => {
    return mockNpm().then(s => (server = s));
  });

  after(done => {
    server.stop(done);
  });

  beforeEach(() => {
    logger._logLevel = 999;
    fynDir = Path.join(__dirname, "..", `.tmp_${Date.now()}`);
  });

  afterEach(() => {
    rimraf.sync(fynDir);
  });

  const sortSrc = src => {
    return src
      .split(";")
      .sort()
      .join(";");
  };

  const sortRequests = data => {
    _.each(data.pkgs, pkg => {
      _.each(pkg, v => {
        v.requests = v.requests.map(r => r.join("!")).sort();
        if (v.src) v.src = sortSrc(v.src);
        if (v.dsrc) v.dsrc = sortSrc(v.dsrc);
        delete v.extracted;
      });
    });
    return data;
  };

  const checkResolvedData = (fyn, file) => {
    const expected = Yaml.safeLoad(Fs.readFileSync(file).toString());
    expect(sortRequests(fyn._data)).to.deep.equal(sortRequests(expected));
  };

  const testPkgAFixture = () => {
    const fyn = new Fyn({
      registry: `http://localhost:${server.info.port}`,
      pkgFile: Path.join(__dirname, "../fixtures/pkg-a/package.json"),
      targetDir: "xout",
      cwd: fynDir,
      fynDir,
      ignoreDist: true
    });
    return fyn.resolveDependencies().then(() => {
      // Fs.writeFileSync(Path.resolve("fyn-data.yaml"), Yaml.safeDump(fyn._data));
      checkResolvedData(fyn, Path.join(__dirname, "../fixtures/pkg-a/fyn-data.yaml"));
    });
  };

  it("should resolve dependencies for pkg-a fixture", () => {
    return testPkgAFixture()
      .then(() => testPkgAFixture())
      .then(() => {
        rimraf.sync(Path.join(fynDir, "xout"));
        return testPkgAFixture();
      })
      .then(() => {
        rimraf.sync(Path.join(fynDir, "cache"));
        return testPkgAFixture();
      });
  }).timeout(10000);

  it("should fail when semver doesn't resolve", () => {
    const fyn = new Fyn({
      registry: `http://localhost:${server.info.port}`,
      pkgFile: false,
      pkgData: {
        name: "test",
        version: "1.0.0",
        dependencies: {
          "mod-a": "^14.0.0"
        }
      },
      fynDir,
      cwd: fynDir
    });
    let error;
    return fyn
      .resolveDependencies()
      .catch(err => (error = err))
      .then(() => {
        expect(error).to.exist;
        expect(error.message).includes("No version of mod-a satisfied semver ^14.0.0");
      });
  }).timeout(10000);

  it("should fail when tag doesn't resolve", () => {
    const fyn = new Fyn({
      registry: `http://localhost:${server.info.port}`,
      pkgFile: false,
      pkgData: {
        name: "test",
        version: "1.0.0",
        dependencies: {
          "mod-a": "blah"
        }
      },
      fynDir,
      cwd: fynDir
    });
    let error;
    return fyn
      .resolveDependencies()
      .catch(err => (error = err))
      .then(() => {
        expect(error).to.exist;
        expect(error.message).includes("No version of mod-a satisfied semver blah");
      });
  }).timeout(10000);

  it("should resolve with the `latest` tag", () => {});
});
