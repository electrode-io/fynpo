"use strict";

/* eslint-disable prefer-spread, one-var, max-statements */

const util = require("util");
const chalk = require("chalk");
const logUpdate = require("log-update");

const Levels = {
  debug: 10,
  verbose: 20,
  info: 30,
  warn: 40,
  error: 50,
  fyi: 60,
  none: 100
};

const DEFAULT_SPINNER_INTERVAL = 100;

class CliLogger {
  constructor() {
    this._items = [];
    this._itemOptions = {};
    this._lines = [];
    this._logLevel = Levels.info;
    this.setPrefix();
    this._logItem = true;
    this._saveLogs = [];
  }

  addItem(options) {
    const name = options.name;

    if (this._items.indexOf(name) >= 0) return this;

    options = Object.assign({ lineData: { msg: "" } }, options);
    options._display = chalk[options.color](options.display || name);
    options._msg = this.renderLineMsg(options, "");
    this._itemOptions[name] = options;

    if (this.shouldLogItem()) {
      if (options.spinner) {
        options.spinIx = 0;
        options.spinTimer = setInterval(() => {
          this.updateItem(name);
        }, options.spinInterval || DEFAULT_SPINNER_INTERVAL).unref();
      }
    }

    this._items.push(name);
    this._lines.push(this.renderLine(options));

    return this;
  }

  logItem(flag) {
    this._logItem = flag;
  }

  hasItem(name) {
    return Boolean(this._itemOptions[name]);
  }

  remove(name) {
    const options = this._itemOptions[name];
    if (!options) return this;

    this.clear();

    const x = this._items.indexOf(name);
    this._items.splice(x, 1);
    this._lines.splice(x, 1);
    this._itemOptions[name] = undefined;
    if (options.spinTimer) {
      clearInterval(options.spinTimer);
    }

    this.renderOutput();

    return this;
  }

  setPrefix(x) {
    this._defaultPrefix = x === undefined ? "> " : x;
    return this;
  }

  prefix(x) {
    this._prefix = x;
    return this;
  }

  _genLog(args) {
    let prefix = this._defaultPrefix;

    if (this._prefix !== undefined) {
      prefix = this._prefix || "";
      this.prefix();
    }

    const str = `${prefix}${util.format.apply(util, args)}`;
    this._saveLogs.push(str);

    return str;
  }

  _log(l, args) {
    const str = this._genLog(args);

    if (Levels[l] >= this._logLevel) {
      this.clear();
      process.stdout.write(`${str}\n`);
      this.renderOutput();
    }

    return this;
  }

  shouldLogItem() {
    return this._logItem && this._logLevel <= Levels.info;
  }

  debug() {
    return this._log("debug", arguments);
  }

  verbose() {
    return this._log("verbose", arguments);
  }

  info() {
    return this._log("info", arguments);
  }

  log() {
    return this._log("debug", arguments);
  }

  warn() {
    return this._log("warn", arguments);
  }

  error() {
    return this._log("error", arguments);
  }

  fyi() {
    return this._log("fyi", arguments);
  }

  renderLineMsg(options, data) {
    let display, msg;
    if (typeof data === "string") {
      msg = data;
    } else {
      msg = data.msg;
      display = data.display && chalk[options.color](data.display);
    }
    options._msg = `${display || options._display}: ${msg}`;
    return options._msg;
  }

  renderLine(options) {
    const spin = options.spinner ? `${options.spinner[options.spinIx]} ` : "";
    return `${spin}${options._msg}`;
  }

  updateItem(name, data) {
    const options = this._itemOptions[name];
    if (!options) return this;

    if (data !== undefined) {
      this.renderLineMsg(options, data);
      if (options.save !== false) {
        this._saveLogs.push(options._msg);
      }
    }

    if (this.shouldLogItem()) {
      const x = this._items.indexOf(name);

      if (data === undefined) {
        if (!options.spinner) return this;
        options.spinIx++;
        if (options.spinIx >= options.spinner.length) {
          options.spinIx = 0;
        }
      }

      this._lines[x] = this.renderLine(options);
      this.renderOutput();
    }

    return this;
  }

  renderOutput() {
    if (this.shouldLogItem() && this._lines.length > 0) {
      logUpdate(this._lines.join("\n"));
    }
    return this;
  }

  clear() {
    if (this.shouldLogItem() && this._lines.length > 0) {
      logUpdate.clear();
    }
  }

  static get spinners() {
    return ["|/-\\", "⠁⠁⠉⠙⠚⠒⠂⠂⠒⠲⠴⠤⠄⠄⠤⠠⠠⠤⠦⠖⠒⠐⠐⠒⠓⠋⠉⠈⠈", "⢹⢺⢼⣸⣇⡧⡗⡏", "⣾⣽⣻⢿⡿⣟⣯⣷"];
  }

  static get Levels() {
    return Levels;
  }
}

module.exports = CliLogger;
