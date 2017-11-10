"use strict";

const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const Fyn = require("../../lib/fyn");
const mockNpm = require("../fixtures/mock-npm");
const expect = require("chai").expect;
const _ = require("lodash");

describe("pkg-dep-resolver", function() {
  let server;
  before(() => {
    return mockNpm().then(s => (server = s));
  });

  after(done => {
    server.stop(done);
  });

  const sortRequests = data => {
    _.each(data.pkgs, pkg => {
      _.each(pkg, v => {
        v.requests = v.requests.map(r => r.join("!")).sort();
      });
    });
    return data;
  };

  const checkResolvedData = (fyn, file) => {
    const expected = Yaml.safeLoad(Fs.readFileSync(file).toString());
    expect(sortRequests(fyn._data)).to.deep.equal(sortRequests(expected));
  };

  it("should resolve dependencies for pkg-a fixture", () => {
    const fyn = new Fyn({
      registry: `http://localhost:${server.info.port}`,
      pkgFile: Path.join(__dirname, "../fixtures/pkg-a/package.json")
    });
    return fyn.resolveDependencies().then(() => {
      checkResolvedData(fyn, Path.join(__dirname, "../fixtures/pkg-a/fyn-data.yaml"));
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
          "mod-a": "^3.0.0"
        }
      }
    });
    let error;
    return fyn
      .resolveDependencies()
      .catch(err => (error = err))
      .then(() => {
        expect(error).to.exist;
        expect(error.message).includes("No version of mod-a satisfied semver ^3.0.0");
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
      }
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
