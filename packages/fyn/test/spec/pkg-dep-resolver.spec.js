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
  logger.setItemType(false);
  chalk.enabled = false;
  let server;
  let fynDir;
  before(() => {
    return mockNpm({ logLevel: "warn" }).then(s => (server = s));
  });

  after(done => {
    server.stop(done);
  });

  beforeEach(() => {
    // to debug test, set log level to 0
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
    const sort = pkgs => {
      _.each(pkgs, pkg => {
        _.each(pkg, v => {
          v.requests = v.requests.map(r => r.join("!")).sort();
          if (v.src) v.src = sortSrc(v.src);
          if (v.dsrc) v.dsrc = sortSrc(v.dsrc);
          delete v.extracted;
          v.dist = Object.assign({}, v.dist, { shasum: "test" });
        });
      });
    };
    sort(data.pkgs);
    sort(data.badPkgs);
    return data;
  };

  const checkResolvedData = (fyn, file) => {
    const expected = Yaml.safeLoad(Fs.readFileSync(file).toString());
    expect(sortRequests(fyn._data)).to.deep.equal(sortRequests(expected));
  };

  const testPkgAFixture = deepResolve => {
    const fyn = new Fyn({
      registry: `http://localhost:${server.info.port}`,
      pkgFile: Path.join(__dirname, "../fixtures/pkg-a/package.json"),
      targetDir: "xout",
      cwd: fynDir,
      fynDir,
      ignoreDist: true,
      deepResolve
    });
    const outFname = `fyn-data${deepResolve ? "-dr" : ""}.yaml`;
    const expectOutput = `../fixtures/pkg-a/${outFname}`;
    return fyn.resolveDependencies().then(() => {
      // Fs.writeFileSync(Path.resolve(outFname), Yaml.safeDump(fyn._data));
      checkResolvedData(fyn, Path.join(__dirname, expectOutput));
    });
  };

  it("should resolve dependencies once for pkg-a fixture @deepResolve true", () => {
    return testPkgAFixture(true);
  }).timeout(10000);

  it("should resolve dependencies repeatly for pkg-a fixture @deepResolve true", () => {
    return testPkgAFixture(true)
      .then(() => testPkgAFixture(true))
      .then(() => {
        rimraf.sync(Path.join(fynDir, "xout"));
        return testPkgAFixture(true);
      })
      .then(() => {
        rimraf.sync(Path.join(fynDir, "cache"));
        return testPkgAFixture(true);
      });
  }).timeout(10000);

  it("should resolve dependencies once for pkg-a fixture @deepResolve false", () => {
    return testPkgAFixture(false);
  }).timeout(10000);

  it("should resolve dependencies repeatly for pkg-a fixture @deepResolve false", () => {
    return testPkgAFixture(false)
      .then(() => testPkgAFixture(false))
      .then(() => {
        rimraf.sync(Path.join(fynDir, "xout"));
        return testPkgAFixture(false);
      })
      .then(() => {
        rimraf.sync(Path.join(fynDir, "cache"));
        return testPkgAFixture(false);
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
