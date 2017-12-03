"use strict";

const assert = require("assert");

class Inflight {
  constructor() {
    this.count = 0;
    this.inflights = {};
  }

  add(key, value) {
    assert(value, `Trying to set falsy value for inflight item ${key}`);
    assert(this.inflights[key] === undefined, `Already has inflight item ${key}`);
    this.count++;
    this.inflights[key] = value;

    return value;
  }

  get(key) {
    return this.inflights[key];
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
}

module.exports = Inflight;
