const poof = () => {
  throw new Error("iconv-lite is not bundled");
};
module.exports = {
  encode: poof,
  decode: poof
};
