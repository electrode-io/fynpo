#!/usr/bin/env node

"use strict";

const chalk = require("chalk");
const yargs = require("yargs");
const FynCli = require("./fyn-cli");
const Path = require("path");
const _ = require("lodash");
const logger = require("../lib/logger");

const pickOptions = argv => {
  const keys = [
    "logLevel",
    "forceCache",
    "localOnly",
    "lockOnly",
    "ignoreDist",
    "showDeprecated",
    "registry",
    "cwd",
    "lockfile",
    "saveLogs",
    "colors"
  ];
  return _.pickBy(argv, (v, k) => v !== undefined && keys.indexOf(k) >= 0);
};

const argv = yargs
  .strict(true)

  .command(
    ["install", "i"],
    "install modules",
    () => {},
    argv => {
      const cli = new FynCli(pickOptions(argv));
      cli.install();
    }
  )
  .command(
    ["add [packages..]", "a"],
    "Add packages to dependencies",
    yargs => {
      yargs
        .option("in", {
          type: "string",
          default: "dependencies",
          describe: "add in section: dependencies,dev,optional,peer"
        })
        .option("install", {
          type: "boolean",
          default: true,
          describe: "run install after added"
        });
    },
    argv => {
      const options = pickOptions(argv);
      options.lockfile = false;
      const cli = new FynCli(options);
      cli.add(argv).then(added => {
        if (!added || !argv.install) return;
        options.lockfile = argv.lockfile;
        options.noStartupInfo = true;
        logger.info("installing...");
        return new FynCli(options).install();
      });
    }
  )
  .command(
    "fm",
    "Show the full path to flat-module",
    () => {},
    argv => {
      const file = require.resolve("flat-module/flat-module.js");
      console.log(file);
    }
  )
  .command(
    "bash",
    "setup flat-module env for bash",
    () => {},
    argv => {
      const file = require.resolve("flat-module/flat-module.js");
      let splits = [];

      if (process.env.NODE_OPTIONS) {
        splits = process.env.NODE_OPTIONS.split(" ").filter(x => x);
      }

      for (let i = 0; i < splits.length; i++) {
        if (splits[i] === "-r" || splits[i] === "--require") {
          const ex = splits[i + 1] || "";
          if (ex.indexOf("flat-module") >= 0) {
            if (ex === file) {
              console.log(`echo "Your NODE_OPTIONS is already setup for fyn's flat-module."`);
              return;
            }
            console.log(`echo "Your NODE_OPTIONS already has require for flat module at ${ex}"`);
            return;
          }
        }
      }

      splits.push(`-r ${file}`);

      console.log(`export NODE_OPTIONS="${splits.join(" ")}"`);
    }
  )
  .option("log-level", {
    alias: "q",
    type: "string",
    describe: "One of: debug,verbose,info,warn,error,fyi,none",
    default: "info"
  })
  .option("force-cache", {
    alias: "f",
    type: "boolean",
    describe: "Don't check registry if cache exists."
  })
  .option("local-only", {
    alias: "l",
    type: "boolean",
    describe: "Use only lockfile or local cache.  Fail if miss."
  })
  .option("lock-only", {
    alias: "k",
    type: "boolean",
    describe: "Only resolve with lockfile. Fail if needs changes."
  })
  .options("lockfile", {
    type: "boolean",
    default: true,
    describe: "enable or disable lockfile"
  })
  .option("ignore-dist", {
    alias: "i",
    type: "boolean",
    describe: "Ignore tarball URL in dist from meta."
  })
  .option("show-deprecated", {
    alias: "s",
    type: "boolean",
    describe: "Force show deprecated messages"
  })
  .option("registry", {
    type: "string",
    describe: "override registry url"
  })
  .options("colors", {
    type: "boolean",
    default: true,
    describe: "log with colors (--no-colors turn off)"
  })
  .option("cwd", { type: "string", describe: "Set fyn's working directory" })
  .option("save-logs", { type: "boolean", describe: "save all logs to fyn-debug.log" })
  .demandCommand()
  .usage("fyn [options] <command> [options]")
  .help().argv;
