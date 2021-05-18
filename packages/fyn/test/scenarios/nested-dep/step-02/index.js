/*
  top:
    C: ^3
      A: ^1
    E: ^1.0
      D: ^1.0
        A: ^2
        F: ^1
          A: ^1 || ^2

  Should resolve:
     E@1.0
     C@3.0
     D@1.0
     A@1.0 <-- C's dep
     F@1.0
     __fv_
       A@2.0 <-- D's dep

  TODO: F's A --> A@1.0, should've gotten A@2.0 from D's dep
*/

const rimraf = require("rimraf");
const Path = require("path");

module.exports = {
  title: "should resolve non-top parent's version for nested dep",
  timeout: 20000,
  before: cwd => {
    rimraf.sync(Path.join(cwd, "fyn-lock.yaml"));
  }
};
