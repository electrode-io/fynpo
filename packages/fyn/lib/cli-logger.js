"use strict";

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

class CliLogger {
  constructor() {
    this._items = [];
    this._itemOptions = {};
    this._lines = [];
    this._logLevel = Levels.verbose;
    this._defaultPrefix = ">";
  }

  addItem(options) {
    const name = options.name;
    if (this._items.indexOf(name) >= 0) return;
    this._itemOptions[name] = options;
    this._items.push(name);
    this._lines.push(this.renderLine(name, { msg: "" }));
    return this;
  }

  remove(name) {
    const x = this._items.indexOf(name);
    if (x < 0) return;
    this.clear();
    this._items.splice(x, 1);
    this._lines.splice(x, 1);
    this._itemOptions[name] = undefined;
    this.renderOutput();
    return this;
  }

  setPrefix(x) {
    this._defaultPrefix = x === undefined ? ">" : x;
    return this;
  }

  prefix(x) {
    this._prefix = x;
    return this;
  }

  _log(l, args) {
    if (Levels[l] >= this._logLevel) {
      this.clear();
      args = Array.prototype.slice.apply(args);
      if (this._prefix !== undefined) {
        if (this._prefix) args.unshift(this._prefix);
        this.prefix();
      } else {
        args.unshift(this._defaultPrefix);
      }

      console.log.apply(console, args);
      this.renderOutput();
    }
    return this;
  }

  shouldLogItem() {
    return this._logLevel <= Levels.info;
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

  renderLine(name, data) {
    const options = this._itemOptions[name];
    return `${chalk[options.color](options.display || name)}: ${data.msg}`;
  }

  updateItem(name, data) {
    if (this.shouldLogItem()) {
      const x = this._items.indexOf(name);
      if (x < 0) return;
      this._lines[x] = this.renderLine(name, typeof data === "string" ? { msg: data } : data);
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
}

module.exports = CliLogger;
