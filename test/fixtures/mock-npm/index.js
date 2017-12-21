"use strict";

/* eslint-disable prefer-template */

const electrodeServer = require("electrode-server");
const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const chalk = require("chalk");
const CliLogger = require("../../../lib/cli-logger");
const _ = require("lodash");

function mockNpm(port) {
  const logger = new CliLogger();
  logger._logLevel = CliLogger.Levels.info;
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
        const metaData = Fs.readFileSync(Path.join(__dirname, "metas", `${pkgName}.yml`));
        logger.debug(
          chalk.blue("mock npm: ") + new Date().toLocaleString() + ":",
          "retrieving meta",
          pkgName
        );
        const meta = Yaml.safeLoad(metaData);
        const pkgMeta = _.omit(meta, "etag");
        let etag = request.headers["if-none-match"];
        etag = etag && etag.split(`"`)[1];
        if (etag && pkgName !== "always-change") {
          return reply()
            .code(304)
            .header("ETag", etag);
        }
        return reply(pkgMeta).header("ETag", `"${meta.etag}_${Date.now()}"`);
      }
    });

    const packagesDir = Path.join(__dirname, "tgz");
    server.route({
      method: "GET",
      path: "/{pkgName}/-/{tgzFile}",
      handler: (request, reply) => {
        const pkgName = request.params.pkgName;
        const tgzFile = request.params.tgzFile;
        logger.debug(new Date().toLocaleString() + ":", "fetching", pkgName, tgzFile);
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
