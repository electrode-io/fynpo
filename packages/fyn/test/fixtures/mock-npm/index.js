"use strict";

/* eslint-disable prefer-template */

const electrodeServer = require("electrode-server");
const Fs = require("fs");
const Yaml = require("js-yaml");
const Path = require("path");
const chalk = require("chalk");
const Crypto = require("crypto");
const CliLogger = require("../../../lib/cli-logger");
const _ = require("lodash");
const createTgz = require("./create-tgz");

const TGZ_DIR_NAME = ".tgz";

const CALC_SHASUM = Symbol("calc-shasum");

const metaCache = {};

function calcShasum(meta) {
  if (meta[CALC_SHASUM]) return;
  meta[CALC_SHASUM] = true;
  _.each(meta.versions, vpkg => {
    const tgzFile = Path.basename(vpkg.dist.tarball);
    const tgzData = Fs.readFileSync(Path.join(__dirname, TGZ_DIR_NAME, tgzFile));
    const sha = Crypto.createHash("sha1");
    sha.update(tgzData);
    vpkg.dist.shasum = sha.digest("hex");
  });
}

function readMeta(pkgName) {
  let meta = metaCache[pkgName];

  if (!meta) {
    const metaData = Fs.readFileSync(Path.join(__dirname, "metas", `${pkgName}.yml`));
    meta = Yaml.safeLoad(metaData);
    metaCache[pkgName] = meta;
  }
  calcShasum(meta);

  return meta;
}

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
        logger.debug(
          chalk.blue("mock npm: ") + new Date().toLocaleString() + ":",
          "retrieving meta",
          pkgName
        );
        const meta = readMeta(pkgName);
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

    const packagesDir = Path.join(__dirname, TGZ_DIR_NAME);
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
  createTgz().then(() => mockNpm(4873));
}
