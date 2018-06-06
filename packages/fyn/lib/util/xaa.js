"use strict";

const Promise = require("bluebird");

module.exports = {
  delay: async function delay(n, val) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(typeof val === "function" ? val() : val);
      }, n);
    });
  },

  each: async function awaitEach(array, func) {
    for (let i = 0; i < array.length; i++) {
      await func(array[i], i);
    }
    return undefined;
  },

  map: async function awaitMap(array, func) {
    const awaited = [];
    for (let i = 0; i < array.length; i++) {
      awaited.push(await func(array[i], i));
    }
    return awaited;
  },

  filter: async function awaitFilter(array, func) {
    const filtered = [];
    for (let i = 0; i < array.length; i++) {
      const x = await func(array[i], i);
      if (x) filtered.push(x);
    }

    return filtered;
  },

  try: async function awaitTry(func, val) {
    try {
      return await func();
    } catch (err) {
      return val;
    }
  }
};
