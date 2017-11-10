"use strict";

const electrodeServer = require("electrode-server");
const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");

function mockNpm(port) {
  return electrodeServer({
    connections: {
      default: {
        port: Number.isFinite(port) ? port : 0
      }
    }
  }).tap(server => {
    server.route({
      method: "GET",
      path: "/{pkgName}",
      handler: (request, reply) => {
        const pkgName = request.params.pkgName;
        const meta = Fs.readFileSync(Path.join(__dirname, "metas", `${pkgName}.yml`));
        console.log(new Date().toLocaleString() + ":", "retrieving meta", pkgName);
        reply(Yaml.safeLoad(meta));
      }
    });

    const packagesDir = Path.join(__dirname, "tgz");
    server.route({
      method: "GET",
      path: "/{pkgName}/-/{tgzFile}",
      handler: (request, reply) => {
        const pkgName = request.params.pkgName;
        const tgzFile = request.params.tgzFile;
        console.log(new Date().toLocaleString() + ":", "fetching", pkgName, tgzFile);
        const pkg = Fs.readFileSync(Path.join(packagesDir, tgzFile));
        reply(pkg)
          .header("Content-Disposition", "inline")
          .header("Content-type", "application/x-gzip");
      }
    });
  });
}

module.exports = mockNpm;

if (require.main === module) {
  mockNpm(4873);
}
