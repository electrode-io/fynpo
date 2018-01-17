#!/usr/bin/env node
"use strict";

const Path = require("path");
const Bootstrap = require("../lib/bootstrap");
const makePkgDeps = require("../lib/make-pkg-deps");
const readPackages = require("../lib/read-packages");
const NixClap = require("nix-clap");

const execBootstrap = parsed => {
  const cwd = parsed.opts.cwd || process.cwd();
  const bootstrap = new Bootstrap(
    makePkgDeps(readPackages(cwd), parsed.opts.ignore || [])
  ).bootstrap();
};

const execLocal = parsed => {
  const cwd = parsed.opts.cwd || process.cwd();
  const bootstrap = new Bootstrap(
    makePkgDeps(readPackages(cwd), parsed.opts.ignore || [])
  ).updateToLocal();
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
    }
  }
);

const parsed = nixClap.parse();
