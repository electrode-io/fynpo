"use strict";

const Fs = require("fs");
const Path = require("path");
const chalk = require("chalk");
const FynCli = require("./fyn-cli");
const _ = require("lodash");
const CliLogger = require("../lib/cli-logger");
const logger = require("../lib/logger");
const NixClap = require("nix-clap");
const myPkg = require("./mypkg");
const loadRc = require("./load-rc");
const findFlatModule = require("./find-flat-module");

const nixClap = new NixClap({
  name: myPkg.name,
  version: myPkg.version,
  usage: "$0 [options] <command>"
});

function setLogLevel(ll) {
  if (ll) {
    const levels = Object.keys(CliLogger.Levels);
    const real = _.find(levels, l => l.startsWith(ll));
    const x = CliLogger.Levels[real];
    if (x !== undefined) {
      logger._logLevel = x;
    } else {
      logger.error(`Invalid log level "${ll}".  Supported levels are: ${levels.join(", ")}`);
      exit(1);
    }
  }
}

const pickOptions = argv => {
  setLogLevel(argv.opts.logLevel);

  chalk.enabled = argv.opts.colors;

  let cwd = argv.opts.cwd || process.cwd();

  if (!Path.isAbsolute(cwd)) {
    cwd = Path.join(process.cwd(), cwd);
  }

  const rc = loadRc(cwd);

  nixClap.applyConfig(rc, argv);

  argv.opts.cwd = cwd;

  chalk.enabled = argv.opts.colors;

  if (!argv.source.saveLogs.startsWith("cli")) {
    argv.opts.saveLogs = undefined;
  }

  logger.debug("Final RC", JSON.stringify(argv.opts));

  setLogLevel(argv.opts.logLevel);
  if (argv.opts.progress) logger.setItemType(argv.opts.progress);

  return argv.opts;
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
  },
  stat: {
    desc: "Show stats of installed packages",
    usage: "$0 $1 <package-name>[@semver] [...]",
    args: "<string packages..>",
    exec: argv => {
      return new FynCli(pickOptions(argv)).stat(argv);
    },
    options: {
      follow: {
        desc: "automatically stat first [n] dependents up to top",
        type: "number",
        default: 0
      }
    }
  }
};

if (process.platform === "win32") {
  commands.win = {
    desc: `Generate setup file "fynwin.cmd" at your CWD.`,
    exec: () => {
      Fs.writeFileSync(
        Path.resolve("fynwin.cmd"),
        `set NODE_OPTIONS=-r ${findFlatModule()}\r\n@(goto) 2>nul & del "%~f0"\r\n`
      );
      logger.fyi(
        `${chalk.green("fynwin.cmd")} generated at ${chalk.magenta(process.cwd())} for you.`
      );
      logger.fyi(`You can run it by typing ${chalk.magenta("fynwin")}. It will delete itself.`);
    }
  };
}

const run = () => {
  return nixClap.init(options, commands).parseAsync();
};

run();
