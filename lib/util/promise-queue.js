"use strict";

/* eslint-disable no-magic-numbers, max-statements */

const EventEmitter = require("events");
const assert = require("assert");
const _ = require("lodash");
const Promise = require("bluebird");
const Inflight = require("./inflight");
// const logger = require("../logger");
const PAUSE_ITEM = Symbol("pause");
const RESUME_ITEM = Symbol("resume");
const WATCH_PERIOD = 500;

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
    this._watchTime = options.watchTime;
    this._id = 1;
  }

  wait() {
    return this.isPending()
      ? new Promise((resolve, reject) => {
          const h = data => {
            if (data.error) {
              this.removeListener("done", h);
              reject(data.error);
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

    if (data.item !== RESUME_ITEM && data.id > 0) {
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

  pendingWatcher() {
    if (this._pending.isEmpty() && !this._watched) return;

    const watched = [];
    const still = [];
    const now = Date.now();

    _.each(this._pending.inflights, (v, id) => {
      const lastXTime = this._pending.lastCheckTime(id, now);
      const time = this._pending.time(id, now);
      if (lastXTime >= this._watchTime) {
        watched.push({ item: v.value.item, promise: v.value.promise, time });
        this._pending.resetCheckTime(id, now);
      } else if (time >= this._watchTime) {
        still.push({ item: v.value.item, promise: v.value.promise, time });
      }
    });

    if (still.length > 0 || watched.length > 0) {
      this._watched = true;
      this.emit("watch", { total: watched.length + still.length, watched, still });
    } else if (this._watched) {
      this._watched = false;
      this.emit("watch", { total: 0, watched, still });
    }

    this._watchTimer = setTimeout(() => this.pendingWatcher(), WATCH_PERIOD).unref();
  }

  setupWatch() {
    if (!this._watchTimer && this._watchTime) {
      process.nextTick(() => this.pendingWatcher());
    }
  }

  _process() {
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

      let promise;

      if (item === RESUME_ITEM) {
        promise = Promise.resolve({});
      } else {
        promise = this._processItem(item, id);
        if (!promise || !promise.then) {
          promise = Promise.resolve(promise);
        }
      }

      this._pending.add(id, {
        item,
        promise: promise.then(
          res => this.handleQueueItemDone({ id, item, res }),
          error => {
            this.handleQueueItemDone({ error, id, item });
          }
        )
      });
    }

    this._processing = false;

    this.setupWatch();

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
    return this;
  }

  resume() {
    process.nextTick(() => {
      this.unpause();
      if (this._itemQ.length === 0) {
        this._itemQ.push(RESUME_ITEM);
      }
      this._process();
    });
    return this;
  }

  isPending() {
    return !this._pending.isEmpty() || this._itemQ.length !== 0;
  }
}

module.exports = PromiseQueue;
