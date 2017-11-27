"use strict";

/* eslint-disable no-magic-numbers, max-statements */

const EventEmitter = require("events");
const assert = require("assert");
const Promise = require("bluebird");
const _ = require("lodash");

class PromiseQueue extends EventEmitter {
  constructor(options) {
    assert(
      options && typeof options.processItem === "function",
      "must provide options.processItem callback"
    );
    super();
    this._pendingPromises = {};
    this._itemQ = options.itemQ || [];
    this._concurrency = options.concurrency || 15;
    this._processItem = options.processItem;
    this._stopOnError = options.stopOnError;
    this._failed = false;
    this._timeout = options.timeout; // TODO
    this._id = 1;
  }

  wait() {
    return this.isPending()
      ? new Promise((resolve, reject) => {
          this.on("done", resolve);
          this.on("fail", reject);
        })
      : Promise.resolve();
  }

  setItemQ(itemQ, defer) {
    this._itemQ = itemQ;
    this._empty = !itemQ || itemQ.length === 0;
    if (!defer) this._process();
  }

  addItem(data, defer) {
    this._empty = false;
    this._itemQ.push(data);
    if (!defer) this._process();
  }

  handleQueueItemDone(data) {
    delete this._pendingPromises[data.id];
    if (this._failed) {
      return;
    }
    if (data.error) {
      this.emit("failItem", data);
      if (this._stopOnError) {
        this._failed = true;
        this.emit("fail", data);
        return;
      }
    } else {
      this.emit("doneItem", data);
    }

    this.emitEmpty();

    if (this._itemQ.length > 0) {
      this._process();
    } else if (_.isEmpty(this._pendingPromises)) {
      const endTime = Date.now();
      const totalTime = endTime - this._startTime;
      const res = {
        item: data.item,
        startTime: this._startTime,
        endTime,
        totalTime
      };
      this.emit("done", res);
    }
  }

  emitEmpty() {
    if (this._itemQ.length === 0 && !this._empty) {
      this.emit("empty");
      this._empty = true;
    }
  }

  _process() {
    if (this._startTime === undefined) {
      this._startTime = Date.now();
    }

    if (this._itemQ.length === 0) {
      this.emitEmpty();
      return;
    }

    let i = Object.keys(this._pendingPromises).length;
    for (; this._itemQ.length > 0 && i < this._concurrency; i++) {
      const id = this._id++;
      const item = this._itemQ.shift();
      this._pendingPromises[id] = this._processItem(item, id).then(
        res => this.handleQueueItemDone({ id, item, res }),
        error => {
          this.handleQueueItemDone({ error, id, item });
        }
      );
    }
  }

  isPending() {
    return !_.isEmpty(this._pendingPromises) || this._itemQ.length !== 0;
  }
}

module.exports = PromiseQueue;
