#!/usr/bin/env node

import Path from "path";
import NixClap from "nix-clap";
import Bootstrap from "./bootstrap";
import Prepare from "./prepare";
import makePkgDeps from "./make-pkg-deps";
import readPackages from "./read-packages";
import logger from "./logger";
import Fs from "fs";

const makeBootstrap = (parsed) => {
  const cwd = parsed.opts.cwd || process.cwd();
  return new Bootstrap(
    makePkgDeps(readPackages(cwd), parsed.opts.ignore || [], parsed.opts.only || []),
    parsed.opts
  );
};

const execBootstrap = (parsed) => {
  const bootstrap = makeBootstrap(parsed);
  let statusCode = 0;
  logger.debug("CLI options", JSON.stringify(parsed));
  return bootstrap
    .exec({
      build: parsed.opts.build,
      fynOpts: parsed.opts.fynOpts,
      concurrency: parsed.opts.concurrency,
      skip: parsed.opts.skip,
    })
    .then(
      () => {
        bootstrap.logErrors();
        statusCode = bootstrap.failed;
      },
      () => {
        bootstrap.logErrors();
        statusCode = 1;
      }
    )
    .finally(() => {
      if (statusCode !== 0 || parsed.opts.saveLog) {
        Fs.writeFileSync("fynpo-debug.log", logger.logData.join("\n") + "\n");
        logger.error("Please check the file fynpo-debug.log for more info.");
      }
      process.exit(statusCode);
    });
};

const execLocal = (parsed) => {
  return makeBootstrap(parsed).updateToLocal();
};

const execPrepare = (parsed) => {
  const opts = Object.assign({ cwd: process.cwd() }, parsed.opts);

  return new Prepare(
    opts,
    makePkgDeps(readPackages(opts.cwd), parsed.opts.ignore || [], [])
  ).exec();
};

const nixClap = new NixClap({
  usage: "$0 [command] [options]",
  handlers: {
    parsed: (data) => {
      try {
        const cwd = data.parsed.opts.cwd || process.cwd();
        /* eslint-disable @typescript-eslint/no-var-requires */
        data.nixClap.applyConfig(require(Path.join(cwd, "lerna.json")).fynpo, data.parsed);
      } catch (e) {
        // Error
      }
    },
  },
}).init(
  {
    cwd: {
      type: "string",
      desc: "set fynpo's working directory",
    },
    ignore: {
      alias: "i",
      type: "string array",
      desc: "list of packages to ignore",
    },
    skip: {
      type: "string array",
      desc: "list of packages to skip running fyn install on, but won't ignore",
    },
    only: {
      alias: "o",
      type: "string array",
      desc: "list of packages to handle only",
    },
    deps: {
      alias: "d",
      type: "number",
      default: 10,
      desc: "level of deps to include even if they were ignored",
    },
    "save-log": {
      alias: "sl",
      type: "boolean",
      default: false,
      desc: "save logs to fynpo-debug.log",
    },
    tag: {
      type: "boolean",
      default: true,
      desc: "no-tag to skip creating tags",
    },
  },
  {
    bootstrap: {
      alias: "b",
      desc: "bootstrap packages",
      default: true,
      exec: execBootstrap,
      options: {
        build: {
          type: "boolean",
          default: true,
          desc: "run npm script build if no prepare",
        },
        concurrency: {
          alias: "cc",
          type: "number",
          default: 3,
          desc: "number of packages to bootstrap concurrently",
        },
      },
    },
    local: {
      alias: "l",
      desc: "update packages dependencies to point to local",
      exec: execLocal,
    },
    prepare: {
      alias: "p",
      desc: "Prepare packages versions for publish",
      exec: execPrepare,
    },
  }
);

nixClap.parseAsync();
