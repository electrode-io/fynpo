#!/usr/bin/env node
"use strict";

const Path = require("path");
const NixClap = require("nix-clap");
const Bootstrap = require("../lib/bootstrap");
const Prepare = require("../lib/prepare");
const makePkgDeps = require("../lib/make-pkg-deps");
const readPackages = require("../lib/read-packages");
const logger = require("../lib/logger");

const makeBootstrap = parsed => {
  const cwd = parsed.opts.cwd || process.cwd();
  return new Bootstrap(makePkgDeps(readPackages(cwd), parsed.opts.ignore || []));
};

const execBootstrap = parsed => {
  const bootstrap = makeBootstrap(parsed);
  return bootstrap
    .exec()
    .then(() => {
      bootstrap.logErrors();
      process.exit(bootstrap.failed);
    })
    .catch(err => {
      logger.error(err);
      process.exit(1);
    });
};

const execLocal = parsed => {
  return makeBootstrap(parsed).updateToLocal();
};

const execPrepare = parsed => {
  const cwd = parsed.opts.cwd || process.cwd();
  return new Prepare(cwd, makePkgDeps(readPackages(cwd), parsed.opts.ignore) || []).exec();
};

const nixClap = new NixClap({
  usage: "$0 [command] [options]",
  handlers: {
    parsed: data => {
      try {
        const cwd = data.parsed.opts.cwd || process.cwd();
        data.nixClap.applyConfig(require(Path.join(cwd, "lerna.json")).fynpo, data.parsed);
      } catch (e) {}
    }
  }
}).init(
  {
    cwd: {
      type: "string",
      desc: "set fynpo's working directory"
    },
    ignore: {
      alias: "i",
      type: "string array",
      desc: "list of packages to ignore"
    }
  },
  {
    bootstrap: {
      alias: "b",
      desc: "bootstrap packages",
      default: true,
      exec: execBootstrap
    },
    local: {
      alias: "l",
      desc: "update packages dependencies to point to local",
      exec: execLocal
    },
    prepare: {
      alias: "p",
      desc: "Prepare packages versions for publish",
      exec: execPrepare
    }
  }
);

nixClap.parseAsync();
