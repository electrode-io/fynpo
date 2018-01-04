"use strict";

// generate a simple and fairly unique id

module.exports = function() {
  return (
    Math.random()
      .toString(36)
      .substr(2, 10) +
    "_" +
    Date.now().toString(36)
  );
};
