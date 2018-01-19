"use strict";

const Fs = require("fs");
const Path = require("path");
const chalk = require("chalk");
const FynCli = require("./fyn-cli");
const _ = require("lodash");
const logger = require("../lib/logger");
const NixClap = require("nix-clap");
const myPkg = require("./mypkg");

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
    "colors",
    "production",
    "progress",
    "concurrency"
  ];
  const opts = _.pickBy(argv.opts, (v, k) => v !== undefined && keys.indexOf(k) >= 0);
  if (argv.source.saveLogs.startsWith("cli")) {
    opts.saveLogs = argv.opts.saveLogs;
  }
  return opts;
};

const findFlatModule = () => {
  try {
    return eval("require").resolve("flat-module/flat-module.js");
  } catch (e) {
    return Path.join(__dirname, "../dist/flat-module.js");
  }
};

const options = {
  "log-level": {
    alias: "q",
    type: "string",
    desc: "One of: debug,verbose,info,warn,error,fyi,none",
    default: "info"
  },
  "save-logs": {
    type: "string",
    alias: "sl",
    default: "fyn-debug.log",
    desc: "Save all logs to the specified file"
  },
  colors: {
    type: "boolean",
    default: true,
    desc: "Log with colors (--no-colors turn off)"
  },
  progress: {
    type: "enum",
    alias: "pg",
    requiresArg: true,
    default: "normal",
    enum: /^(normal|simple|none)$/,
    desc: "Log progress type: normal,simple,none"
  },
  cwd: {
    type: "string",
    requireArg: true,
    desc: "Set fyn's working directory"
  },
  "force-cache": {
    alias: "f",
    type: "boolean",
    desc: "Don't check registry if cache exists."
  },
  "local-only": {
    alias: "l",
    type: "boolean",
    desc: "Use only lockfile or local cache.  Fail if miss."
  },
  "lock-only": {
    alias: "k",
    type: "boolean",
    desc: "Only resolve with lockfile. Fail if needs changes."
  },
  lockfile: {
    type: "boolean",
    alias: "lf",
    default: true,
    desc: "Enable or disable (--no-lockfile) lockfile"
  },
  "ignore-dist": {
    alias: "i",
    type: "boolean",
    desc: "Ignore host in tarball URL from meta dist."
  },
  "show-deprecated": {
    alias: "s",
    type: "boolean",
    desc: "Force show deprecated messages"
  },
  production: {
    type: "boolean",
    alias: "prod",
    default: false,
    desc: "Do not install devDependencies",
    allowCmd: ["add", "remove", "install"]
  },
  registry: {
    type: "string",
    alias: "reg",
    requireArg: true,
    desc: "Override registry url"
  },
  concurrency: {
    type: "number",
    alias: "cc",
    desc: "Max network concurrency",
    default: 15
  }
};

const commands = {
  install: {
    alias: "i",
    desc: "Install modules",
    exec: argv => {
      const cli = new FynCli(pickOptions(argv));
      cli.install();
    },
    default: true
  },
  add: {
    alias: "a",
    args: "[packages..]",
    usage: "$0 $1 [packages..]",
    desc: "add packages to package.json",
    exec: argv => {
      const options = pickOptions(argv);
      options.lockfile = false;
      const cli = new FynCli(options);
      const opts = Object.assign({}, argv.opts, argv.args);
      cli.add(opts).then(added => {
        if (!added || !argv.opts.install) return;
        options.lockfile = argv.opts.lockfile;
        options.noStartupInfo = true;
        logger.info("installing...");
        return new FynCli(options).install();
      });
    },
    options: {
      dev: {
        alias: ["d"],
        type: "array",
        desc: "List of packages to add to devDependencies"
      },
      opt: {
        alias: ["o"],
        type: "array",
        desc: "List of packages to add to optionalDependencies"
      },
      peer: {
        alias: ["p"],
        type: "array",
        desc: "List of packages to add to peerDependencies"
      },
      install: {
        type: "boolean",
        default: true,
        desc: "Run install after added"
      }
    }
  },
  remove: {
    alias: "rm",
    args: "<packages..>",
    desc: "Remove packages from package.json and install",
    exec: argv => {
      const options = pickOptions(argv);
      options.lockfile = false;
      const cli = new FynCli(options);
      const opts = Object.assign({}, argv.opts, argv.args);
      if (cli.remove(opts)) {
        if (!argv.opts.install) return;
        options.lockfile = argv.opts.lockfile;
        options.noStartupInfo = true;
        logger.info("installing...");
        return new FynCli(options).install();
      }
    },
    options: {
      install: {
        type: "boolean",
        default: true,
        desc: "Run install after removed"
      }
    }
  },
  fm: {
    desc: "Show the full path to flat-module",
    exec: () => {
      console.log(findFlatModule());
    }
  },
  bash: {
    desc: "Setup flat-module env for bash",
    exec: () => {
      const file = findFlatModule();
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
  }
};

const run = () => {
  return new NixClap({ name: myPkg.name, version: myPkg.version, usage: "$0 [options] <command>" })
    .init(options, commands)
    .parseAsync();
};

run();
