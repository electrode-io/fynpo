"use strict";

module.exports = {
  delay: async function delay(n, val) {
    let handler;

    const c = val && val.constructor.name;

    if (c === "AsyncFunction") handler = resolve => setTimeout(async () => resolve(await val()), n);
    else if (c === "Function") handler = resolve => setTimeout(() => resolve(val()), n);
    else handler = resolve => setTimeout(() => resolve(val), n);

    return new Promise(handler);
  },

  each: async function awaitEach(array, func) {
    for (let i = 0; i < array.length; i++) {
      await func(array[i], i);
    }
    return undefined;
  },

  map: async function awaitMap(array, func, options = { concurrency: 1 }) {
    const awaited = [];

    const concurrency = options.concurrency;

    if (concurrency > 1) {
      let i = 0;
      let j;

      while (i < array.length) {
        const processing = [];

        for (j = 0; j < concurrency && i < array.length; i++, j++) {
          processing.push(func(array[i], i));
        }

        for (let k = 0; k < j; k++) {
          awaited.push(await processing[k]);
        }
      }
    } else {
      for (let i = 0; i < array.length; i++) {
        awaited.push(await func(array[i], i));
      }
    }

    return awaited;
  },

  filter: async function awaitFilter(array, func) {
    const filtered = [];
    for (let i = 0; i < array.length; i++) {
      const x = await func(array[i], i);
      if (x) filtered.push(array[i]);
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
