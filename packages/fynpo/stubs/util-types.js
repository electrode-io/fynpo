// undici fetch support node.js 16.5+ only and it uses "util/types"
// but before 16, it's util.types, and wepback bundle fails on it
// so stub it.  we don't use undici fetch anyways.
module.exports = require("util").types;
