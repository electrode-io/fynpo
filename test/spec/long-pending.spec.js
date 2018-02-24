"use strict";

/* eslint-disable prefer-spread, max-len */

const sinon = require("sinon");
const logger = require("../../lib/logger");
const longPending = require("../../lib/long-pending");

describe("long-pending", function() {
  let logItems;
  let logs;
  let sandbox;
  beforeEach(() => {
    logs = [];
    logItems = {};
    sandbox = sinon.createSandbox();
    sandbox.stub(logger, "addItem").callsFake(o => {
      logItems[o.name] = o;
    });
    sandbox.stub(logger, "updateItem").callsFake((name, msg) => {
      logs.push(`${name}: ${msg}`);
    });
    sandbox.stub(logger, "removeItem").callsFake(name => {
      delete logItems[name];
    });
    sandbox.stub(logger, "hasItem").callsFake(name => {
      return logItems[name];
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should add long wait items to logger", () => {
    longPending.onWatch({ total: 1, watched: [{ item: "test", time: 50 }], still: [] });
    expect(logItems).to.deep.equal({
      "package pending fetch": {
        name: "package pending fetch",
        display: undefined,
        color: "yellow"
      }
    });
    expect(logs).to.deep.equal(["package pending fetch: test (0.05secs)"]);
  });

  it("should remove long wait items that finish", () => {
    longPending.onWatch({ total: 1, watched: [{ item: "test", time: 50 }], still: [] });
    expect(logItems).to.deep.equal({
      "package pending fetch": {
        name: "package pending fetch",
        display: undefined,
        color: "yellow"
      }
    });
    expect(logs).to.deep.equal(["package pending fetch: test (0.05secs)"]);
    longPending.onWatch({ total: 0 });
    expect(logItems).to.deep.equal({});
  });

  it("should update existing items", () => {
    longPending.onWatch({ total: 1, watched: [{ item: "test", time: 50 }], still: [] });
    expect(logItems).to.deep.equal({
      "package pending fetch": {
        name: "package pending fetch",
        display: undefined,
        color: "yellow"
      }
    });
    expect(logs).to.deep.equal(["package pending fetch: test (0.05secs)"]);
    longPending.onWatch({ total: 1, watched: [], still: [{ item: "test", time: 150 }] });
    expect(logs).to.deep.equal([
      "package pending fetch: test (0.05secs)",
      "package pending fetch: test (0.15secs)"
    ]);
  });

  it("should crop extra items beyond max", () => {
    const watched = Array.apply(null, { length: 8 }).map((v, ix) => {
      return { item: `i${ix}`, time: 50 };
    });
    const still = Array.apply(null, { length: 5 }).map((v, ix) => {
      return { item: ix, time: 150 };
    });
    longPending.onWatch({ total: 13, watched, still }, { makeId: ix => `s${ix}` });
    expect(logs).to.deep.equal([
      "package pending fetch: Total: 13, first 10: i0 (0.05secs), i1 (0.05secs), i2 (0.05secs), i3 (0.05secs), i4 (0.05secs), i5 (0.05secs), i6 (0.05secs), i7 (0.05secs), s0 (0.15secs), s1 (0.15secs)"
    ]);
  });
});
