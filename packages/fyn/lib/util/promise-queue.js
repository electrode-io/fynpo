"use strict";

/* eslint-disable no-magic-numbers, max-statements */

const EventEmitter = require("events");
const assert = require("assert");
const Promise = require("bluebird");
const _ = require("lodash");
const Inflight = require("./inflight");

const PAUSE_ITEM = Symbol("pause");

class PromiseQueue extends EventEmitter {
  constructor(options) {
    assert(
      options && typeof options.processItem === "function",
      "must provide options.processItem callback"
    );
    super();
    this._pending = new Inflight();
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
          const h = data => {
            if (data.error) {
              this.removeListener("done", h);
              reject(data);
            } else {
              this.removeListener("fail", h);
              resolve(data);
            }
          };
          this.once("done", h);
          this.once("fail", h);
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
    if (!defer) process.nextTick(() => this._process());
  }

  handleQueueItemDone(data) {
    if (data.id > 0) {
      this._pending.remove(data.id);
    }

    if (this._failed) {
      return;
    }

    if (data.id > 0) {
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
    }

    this.emitEmpty();

    if (!this._pause && this._itemQ.length > 0) {
      this._process();
    } else if (this._pending.isEmpty()) {
      if (this._pause) {
        this.emit("pause");
      } else {
        this.emitDone();
      }
    }
  }

  emitDone() {
    const endTime = Date.now();
    const totalTime = endTime - this._startTime;
    const res = {
      startTime: this._startTime,
      endTime,
      totalTime
    };
    this.emit("done", res);
  }

  emitEmpty() {
    if (this._itemQ.length === 0 && !this._empty) {
      this._empty = true; // make sure only emit empty event once
      this.emit("empty");
    }
  }

  _process(msg) {
    if (this._startTime === undefined) {
      this._startTime = Date.now();
    }

    if (this._processing || this._pause || this._itemQ.length === 0) return 0;

    this._processing = true;
    let count = 0;
    let i = this._pending.getCount();
    for (; this._itemQ.length > 0 && i < this._concurrency; i++) {
      const item = this._itemQ.shift();
      if (item === PAUSE_ITEM) {
        this._pause = true;
        // since no more pending can be added at this point, if there're no
        // existing pending, then setup to emit the pause event.
        if (this._pending.isEmpty()) {
          process.nextTick(() => {
            this.handleQueueItemDone({ id: 0 });
          });
        }
        break;
      }
      count++;
      const id = this._id++;
      const promise = this._processItem(item, id);
      if (promise && promise.then) {
        this._pending.add(
          id,
          promise.then(
            res => this.handleQueueItemDone({ id, item, res }),
            error => {
              this.handleQueueItemDone({ error, id, item });
            }
          )
        );
      } else {
        this._pending.add(id, promise);
        process.nextTick(() => {
          this.handleQueueItemDone({ id, item, res: promise });
        });
      }
    }

    this._processing = false;

    return count;
  }

  static get pauseItem() {
    return PAUSE_ITEM;
  }

  get isPause() {
    return this._pause;
  }

  unpause() {
    this._pause = false;
  }

  resume() {
    process.nextTick(() => {
      this.unpause();
      this._process();
    });
  }

  isPending() {
    return !this._pending.isEmpty() || this._itemQ.length !== 0;
  }
}

module.exports = PromiseQueue;
