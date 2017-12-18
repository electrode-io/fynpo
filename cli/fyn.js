#!/usr/bin/env node

"use strict";

const chalk = require("chalk");
const yargs = require("yargs");
const FynCli = require("./fyn-cli");
const Path = require("path");
const _ = require("lodash");

const argv = yargs
  .strict(true)

  .command(
    ["install", "i"],
    "install modules",
    () => {},
    // yargs => {
    //   yargs.option("save", {
    //     type: "boolean",
    //     describe: "Save dependencies"
    //   });
    // },
    argv => {
      const options = _.pick(argv, [
        "logLevel",
        "forceCache",
        "localOnly",
        "lockOnly",
        "ignoreDist",
        "showDeprecated"
      ]);
      const cli = new FynCli(options);
      cli.install();
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
  // .option("cwd", { type: "string", describe: "Change fyn's working directory" })
  .demandCommand()
  .usage("fyn [options] <command> [options]")
  .help().argv;
