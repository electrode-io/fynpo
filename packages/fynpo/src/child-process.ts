/* copied from https://github.com/lerna/lerna/blob/main/core/child-process/index.js */

/* eslint-disable max-params */
import chalk from "chalk";
import execa from "execa";
import logTransformer from "strong-log-transformer";
import os from "os";
import boxen from "boxen";
import logger from "./logger";

const colorWheel = ["cyan", "magenta", "blue", "yellow", "green", "red"];
const NUM_COLORS = colorWheel.length;
const children = new Set();

let currentColor = 0;

/**
 * @param {import("execa").ExecaError<string>} result
 * @returns {number}
 */
const getExitCode = (result) => {
  if (result.exitCode) {
    return result.exitCode;
  }

  // https://nodejs.org/docs/latest-v6.x/api/child_process.html#child_process_event_close
  if (typeof result.code === "number") {
    return result.code;
  }

  // https://nodejs.org/docs/latest-v6.x/api/errors.html#errors_error_code
  if (typeof result.code === "string") {
    return os.constants.errno[result.code];
  }

  return process.exitCode;
};

/**
 * @param {import("execa").ExecaChildProcess<string> & { pkg?: fynpo package }} spawned
 */
const wrapError = (spawned, runOpts) => {
  if (spawned.pkg) {
    return spawned.catch((err) => {
      // ensure exit code is always a number
      err.exitCode = getExitCode(err);

      // log non-lerna error cleanly
      err.pkg = spawned.pkg;

      err.runOpts = runOpts;

      throw err;
    });
  }

  return spawned;
};

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import("execa").Options} opts
 */
const spawnProcess = (command, args, opts) => {
  const child = execa(command, args, opts);
  const drain = (exitCode, signal) => {
    children.delete(child);

    // don't run repeatedly if this is the error event
    if (signal === undefined) {
      child.removeListener("exit", drain);
    }

    // propagate exit code, if any
    if (exitCode) {
      process.exitCode = exitCode;
    }
  };

  child.once("exit", drain);
  child.once("error", drain);

  if (opts.pkg) {
    (child as any).pkg = opts.pkg;
  }

  children.add(child);

  return child;
};

/**
 * Execute a command synchronously.
 * @param {string} command
 * @param {string[]} args
 * @param {import("execa").SyncOptions} [opts]
 */
export const execSync = (command, args, opts) => {
  return execa.sync(command, args, opts).stdout;
};

/**
 * Execute a command asynchronously, piping stdio by default.
 * @param {string} command
 * @param {string[]} args
 * @param {import("execa").Options} [opts]
 */
export const exec = (command, args, opts) => {
  const options = Object.assign({ stdio: "pipe" }, opts);
  const spawned = spawnProcess(command, args, options);

  return wrapError(spawned, {});
};

/**
 * Spawn a command asynchronously, streaming stdio with optional prefix.
 * @param {string} command
 * @param {string[]} args
 * @param {import("execa").Options} [opts]
 * @param {string} [prefix]
 */
export const spawnStreaming = (command, args, opts, prefix) => {
  const options = Object.assign({}, opts);
  options.stdio = ["ignore", "pipe", "pipe"];

  const spawned = spawnProcess(command, args, options);

  const stdoutOpts: any = { tag: "" };
  const stderrOpts: any = { tag: "" };

  if (prefix) {
    const colorName = colorWheel[currentColor % NUM_COLORS];
    const color = chalk[colorName];

    currentColor += 1;

    stdoutOpts.tag = `${color.bold(prefix)}:`;
    stderrOpts.tag = `${color(prefix)}:`;
  }

  const banner = boxen(`Starting command  '${command} ${args.join(" ")}'`, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
  });

  banner.split("\n").forEach((l) => {
    logger.prefix(false).info(`${stdoutOpts.tag} ${l}`);
  });

  // Avoid "Possible EventEmitter memory leak detected" warning due to piped stdio
  if (children.size > process.stdout.listenerCount("close")) {
    process.stdout.setMaxListeners(children.size);
    process.stderr.setMaxListeners(children.size);
  }

  spawned.stdout.pipe(logTransformer(stdoutOpts)).pipe(process.stdout);
  spawned.stderr.pipe(logTransformer(stderrOpts)).pipe(process.stderr);

  return wrapError(spawned, { stdoutOpts, stderrOpts });
};
