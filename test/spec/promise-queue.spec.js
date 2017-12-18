"use strict";

const PromiseQueue = require("../../lib/util/promise-queue");
const Promise = require("bluebird");

describe("promise-queue", function() {
  const testConcurrency = (done, concurrency, expected) => {
    let save = [];
    const process = () => {
      return new Promise(resolve => {
        save.push(resolve);
      });
    };
    const pq = new PromiseQueue({
      concurrency,
      processItem: x => process(x)
    });
    pq.on("done", () => done());
    for (let x = 0; x <= expected; x++) {
      pq.addItem(x, true);
    }
    pq._process();
    expect(save.length, "should queue up expected number of concurrent items").to.equal(expected);
    const tmpSave = save;
    save = [];
    for (let x = 0; x < expected; x++) {
      tmpSave[x]();
    }
    setTimeout(() => {
      expect(save.length === 1);
      save[0]();
    }, 10);
  };

  it("should handle optional conncurrency", done => testConcurrency(done, 3, 3));

  it("should handle default conncurrency", done => testConcurrency(done, undefined, 15));

  it("should handle fail item", done => {
    let n = 0;
    const process = () => {
      return new Promise((resolve, reject) => {
        n++;
        if (n === 3) {
          reject("test");
        } else {
          resolve();
        }
      });
    };
    const pq = new PromiseQueue({
      concurrency: 5,
      processItem: x => process(x)
    });
    for (let x = 0; x < 15; x++) {
      pq.addItem(x);
    }
    let failed;
    pq.on("done", () => {
      expect(failed).to.be.ok;
      done();
    });
    pq.on("failItem", data => (failed = data.error));
  });

  it("should stop on error", done => {
    let n = 0;
    const process = () => {
      return new Promise((resolve, reject) => {
        n++;
        if (n === 10) {
          reject("test");
        } else {
          resolve();
        }
      });
    };
    const pq = new PromiseQueue({
      concurrency: 5,
      stopOnError: true,
      processItem: x => process(x)
    });
    for (let x = 0; x < 15; x++) {
      pq.addItem(x);
    }
    let failed;
    pq.on("done", () => {
      throw new Error("not expecting done event");
    });
    pq.on("fail", () => {
      expect(failed).to.be.ok;
      done();
    });
    pq.on("failItem", data => (failed = data.error));
  });

  it("should emit doneItem event", done => {
    const process = () => Promise.resolve();
    const pq = new PromiseQueue({
      concurrency: 5,
      processItem: x => process(x)
    });
    let n = 0;
    pq.on("doneItem", () => {
      n++;
    });
    pq.on("done", () => {
      expect(n).to.equal(15);
      done();
    });
    for (let x = 0; x < 15; x++) {
      pq.addItem(x);
    }
  });

  it("should take initial item Q", done => {
    let sum = 0;
    const items = [1, 2, 3, 4, 5];
    const pq = new PromiseQueue({
      concurrency: 2,
      processItem: x => Promise.resolve((sum += x))
    });
    pq.on("done", () => {
      expect(sum).to.equal(15);
      done();
    });
    pq.setItemQ(items);
  });
});
