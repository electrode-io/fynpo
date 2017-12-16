"use strict";

const assert = require("assert");

class Inflight {
  constructor() {
    this.count = 0;
    this.inflights = {};
  }

  add(key, value) {
    assert(this.inflights[key] === undefined, `Already has inflight item ${key}`);
    this.count++;
    const now = Date.now();
    this.inflights[key] = { start: now, lastXTime: now, value };

    return value;
  }

  get(key) {
    const x = this.inflights[key];
    return x && x.value;
  }

  lastCheckTime(key, now) {
    const x = this.inflights[key];
    if (x) {
      const t = (now || Date.now()) - x.lastXTime;
      return t;
    }
    return -1;
  }

  resetCheckTime(key, now) {
    const x = this.inflights[key];
    if (x) {
      x.lastXTime = now || Date.now();
    }
  }

  time(key, now) {
    const x = this.inflights[key];
    if (x) {
      return (now || Date.now()) - x.start;
    }
    return -1;
  }

  remove(key) {
    assert(this.inflights[key] !== undefined, `Removing non-existing inflight item ${key}`);
    assert(this.count > 0, `Removing inflight item ${key} but count is ${this.count}`);
    this.count--;
    if (this.count === 0) {
      this.inflights = {};
    } else {
      this.inflights[key] = undefined;
    }
  }

  isEmpty() {
    return this.count === 0;
  }

  getCount() {
    return this.count;
  }
}

module.exports = Inflight;
