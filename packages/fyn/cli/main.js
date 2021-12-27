"use strict";

const Path = require("path");
const chalk = require("chalk");
const Promise = require("bluebird");
const FynCli = require("./fyn-cli");
const _ = require("lodash");
const CliLogger = require("../lib/cli-logger");
const logger = require("../lib/logger");
const NixClap = require("nix-clap");
const myPkg = require("./mypkg");
const loadRc = require("./load-rc");
const defaultRc = require("./default-rc");
const fynTil = require("../lib/util/fyntil");
const { runInitPackage } = require("init-package");

function setLogLevel(ll) {
  if (ll) {
    const levels = Object.keys(CliLogger.Levels);
    const real = _.find(levels, l => l.startsWith(ll));
    const x = CliLogger.Levels[real];
    if (x !== undefined) {
      logger._logLevel = x;
    } else {
      logger.error(`Invalid log level "${ll}".  Supported levels are: ${levels.join(", ")}`);
      fynTil.exit(1);
    }
  }
}

const pickEnvOptions = () => {
  const mapping = {
    NODE_ENV: { optKey: "production", checkValue: "production" }
  };

  return Object.keys(mapping).reduce((cfg, envKey) => {
    if (process.env.hasOwnProperty(envKey)) {
      const m = mapping[envKey];
      const ev = process.env[envKey];
      cfg[m.optKey] = ev === m.checkValue;
      logger.info(`setting option ${m.optKey} to ${cfg[m.optKey]} by env ${envKey} value ${ev}`);
    }
  }, {});
};

const pickOptions = async (argv, nixClap, checkFynpo = true) => {
  setLogLevel(argv.opts.logLevel);

  chalk.enabled = argv.opts.colors;

  let cwd = argv.opts.cwd || process.cwd();

  if (!Path.isAbsolute(cwd)) {
    cwd = Path.join(process.cwd(), cwd);
  }

  let fynpo = {};

  if (checkFynpo) {
    try {
      fynpo = await fynTil.loadFynpo(cwd);
    } catch (err) {
      logger.error(err.stack);
      process.exit(1);
    }
  }
  const rcData = loadRc(argv.opts.rcfile && cwd, fynpo.dir);

  const rc = rcData.all || defaultRc;

  _.defaults(argv.opts, rc);
  nixClap.applyConfig(pickEnvOptions(), argv);

  argv.opts.cwd = cwd;

  chalk.enabled = argv.opts.colors;

  if (!argv.source.saveLogs.startsWith("cli")) {
    argv.opts.saveLogs = undefined;
  }

  nixClap.applyConfig(_.get(fynpo, "config.fyn.options", {}), argv);

  logger.debug("Final RC", JSON.stringify(fynTil.removeAuthInfo(argv.opts)));

  setLogLevel(argv.opts.logLevel);
  if (argv.opts.progress) logger.setItemType(argv.opts.progress);

  return { opts: argv.opts, rcData, _cliSource: argv.source };
};

const options = {
  fynlocal: {
    type: "boolean",
    desc: "enable/disable fynlocal mode",
    default: true
  },
  "always-fetch-dist": {
    type: "boolean",
    desc: "fetch package dist tarball during dep resolving",
    default: false
  },
  "central-store": {
    type: "boolean",
    alias: ["central", "cs"],
    desc: "keep single copy of packages in central store",
    default: false
  },
  copy: {
    type: "string array",
    alias: "cp",
    desc: "copy package even in central store mode"
  },
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
    requireArg: true,
    default: "normal",
    enum: /^(normal|simple|none)$/,
    desc: "Log progress type: normal,simple,none"
  },
  cwd: {
    type: "string",
    requireArg: true,
    desc: "Change current working dir"
  },
  "fyn-dir": {
    type: "string",
    desc: "Dir for cache etc, default {HOME}/.fyn"
  },
  "force-cache": {
    alias: "f",
    type: "boolean",
    desc: "Don't check registry if cache exists."
  },
  offline: {
    type: "boolean",
    desc: "Only lockfile or local cache. Fail if miss."
  },
  "lock-only": {
    alias: "k",
    type: "boolean",
    desc: "Only resolve with lockfile. Fail if needs changes."
  },
  "prefer-lock": {
    type: "boolean",
    desc: "Prefer resolving with lockfile."
  },
  lockfile: {
    type: "boolean",
    alias: "lf",
    default: true,
    desc: "Support lockfile"
  },
  "lock-time": {
    type: "string",
    desc: "Lock dependencies by time"
  },
  "npm-lock": {
    type: "boolean",
    desc: "force on/off loading npm lock"
  },
  "refresh-optionals": {
    type: "boolean",
    default: false,
    desc: "refresh all optionalDependencies"
  },
  "refresh-meta": {
    type: "boolean",
    default: false,
    desc: "force refresh package meta from registry"
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
  "deep-resolve": {
    alias: "dr",
    type: "boolean",
    desc: "Resolve dependency tree as deep as possible"
  },
  "source-maps": {
    alias: "sm",
    type: "boolean",
    default: false,
    desc: "Generate pseudo source maps for local linked packages"
  },
  production: {
    type: "boolean",
    alias: "prod",
    default: false,
    desc: "Ignore devDependencies"
    // allowCmd: ["add", "remove", "install"]
  },
  rcfile: {
    type: "boolean",
    default: true,
    desc: "Load .fynrc and .npmrc files"
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
  },
  "build-local": {
    type: "boolean",
    default: true,
    desc: "auto run fyn to install and build local dependency packages"
  },
  "flatten-top": {
    type: "boolean",
    default: true,
    desc: "flattening hoists pkg to top level node_modules"
  },
  layout: {
    type: "enum",
    default: "normal",
    // node_modules package directory layouts
    // normal - top level and hoist deps are all copied node_modules
    // detail - every packages in their own path with version detail and symlink to node_modules
    // TODO: simple - where top level deps are copied, but promoted packages are hoisted with symlinks
    enum: /^(normal|detail)$/,
    desc: "set node_modules packages layout - normal or detail"
  },
  "meta-memoize": {
    type: "string",
    alias: "meta-mem",
    desc: "a url to a server that helps multiple fyn to share meta cache"
  }
};

const commands = {
  install: {
    alias: "i",
    desc: "Install modules",
    async exec(argv, parsed) {
      const cli = new FynCli(await pickOptions(argv, parsed.nixClap));
      return cli.install();
    },
    default: true,
    options: {
      "run-npm": {
        desc: "additional npm scripts to run after install",
        type: "string array"
      },
      "force-install": {
        alias: "fi",
        desc: "force install even if no files changed since last install",
        type: "boolean"
      }
    }
  },
  add: {
    alias: "a",
    args: "[packages..]",
    usage: "$0 $1 [packages..] [--dev <dev packages>]",
    desc: "add packages to package.json",
    exec: async (argv, parsed) => {
      const config = await pickOptions(argv, parsed.nixClap);
      const lockFile = config.lockfile;
      config.lockfile = false;
      const cli = new FynCli(config);
      const opts = Object.assign({}, argv.opts, argv.args);
      return cli.add(opts).then(added => {
        if (!added || !argv.opts.install) return;
        config.lockfile = lockFile;
        config.noStartupInfo = true;
        logger.info("installing...");
        fynTil.resetFynpo();
        return new FynCli(config).install();
      });
    },
    options: {
      dev: {
        alias: ["d"],
        type: "array",
        desc: "List of packages to add to devDependencies"
      },
      opt: {
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
      },
      "pkg-fyn": {
        type: "boolean",
        desc: "save fyn section to package-fyn.json",
        default: false
      }
    }
  },
  remove: {
    alias: "rm",
    args: "<packages..>",
    desc: "Remove packages from package.json and install",
    exec: async (argv, parsed) => {
      const options = await pickOptions(argv, parsed.nixClap);
      const lockFile = options.lockfile;
      options.lockfile = false;
      const cli = new FynCli(options);
      const opts = Object.assign({}, argv.opts, argv.args);
      const removed = await cli.remove(opts);
      if (removed) {
        if (!argv.opts.install) return;
        options.lockfile = lockFile;
        options.noStartupInfo = true;
        fynTil.resetFynpo();
        logger.info("installing...");
        return await new FynCli(options).install();
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
  stat: {
    desc: "Show stats of installed packages",
    usage: "$0 $1 <package-name>[@semver] [...]",
    args: "<string packages..>",
    exec: async (argv, parsed) => {
      return new FynCli(await pickOptions(argv, parsed.nixClap)).stat(argv);
    }
  },
  run: {
    desc: "Run a npm script",
    args: "[script]",
    alias: ["rum", "r"],
    usage: "$0 $1 <command> [-- <args>...]",
    exec: async (argv, parsed) => {
      return new FynCli(await pickOptions(argv, parsed.nixClap, !argv.opts.list)).run(argv);
    },
    options: {
      list: {
        desc: "list scripts",
        alias: "l",
        type: "boolean"
      }
    }
  },
  init: {
    desc: "initialize a package.json file",
    usage: "$0 $1 <command> [--yes]",
    exec: async argv => {
      try {
        await runInitPackage(argv.opts.yes);
      } catch (err) {
        process.exit(1);
      }
    },
    options: {
      yes: {
        alias: ["y"],
        desc: "skip prompt and use default values",
        type: "boolean"
      }
    }
  }
};

const createNixClap = handlers => {
  return new NixClap({
    Promise,
    name: myPkg.name,
    version: myPkg.version,
    usage: "$0 [options] <command>",
    handlers
  });
};

const run = async (args, start, tryRun = true) => {
  fynTil.resetFynpo();

  const handlers = {
    "parse-fail": parsed => {
      if (parsed.commands.length < 1 && parsed.error.message.includes("Unknown command")) {
        parsed.nixClap.skipExec();
      } else {
        parsed.nixClap.showHelp(parsed.error);
      }
    },
    "unknown-option": () => {}
  };

  if (start === undefined && args !== undefined) {
    start = 0;
  }

  const parsed = await createNixClap(handlers)
    .init(options, commands)
    .parseAsync(args, start);

  if (!tryRun || !parsed.error) {
    return;
  }

  if (parsed.error && parsed.commands.length < 1) {
    const x = start === undefined ? 2 : start;
    const args2 = (args || process.argv).slice();
    args2.splice(x, 0, "run");

    await createNixClap()
      .init(options, commands)
      .parseAsync(args2, x);
  } else {
    parsed.nixClap.showHelp(parsed.error);
  }
};

const fun = () => {
  const argv = process.argv.slice();

  argv.splice(2, 0, "run");

  return run(argv, 2, false);
};

module.exports = {
  run,
  fun
};
