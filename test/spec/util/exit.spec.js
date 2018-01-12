"use strict";

const exit = require("../../../lib/util/exit");

describe("exit", function() {
  it("call process.exit", () => {
    const save = process.exit;
    let code;
    process.exit = c => (code = c);
    exit();
    expect(code).to.equal(0);
    exit(new Error());
    expect(code).to.equal(1);
    process.exit = save;
  });
});
