/*
  top:
    A: ^2
    E: ^1.0
      D: ^1.0
        A: ^2
        F: ^1
          A: ^1 || ^2
    C: ^3
      A: ^1

  Should resolve:
    A@2.0
    E@1.0
    C@3.0
    D@1.0
    F@1.0
    __fv_
      A@1.0 <-- C's dep

    F's A --> A@2.0
*/


module.exports = {
  title: "should resolve top version for nested dep",
  timeout: 20000
};
