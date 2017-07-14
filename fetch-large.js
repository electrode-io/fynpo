const url = "https://npme.walmart.com/selenium-server/-/selenium-server-3.4.0.tgz";

const request = require("request");
const Fs = require("fs");
const Path = require("path");

const startTime = Date.now();
console.log("start", startTime);
const stream = Fs.createWriteStream(Path.resolve("selenium-server-3.4.0.tgz"));
request(url).pipe(stream);
stream.on("close", () => {
  const endTime = Date.now();
  console.log("downloaded", "elapse", (endTime - startTime) / 1000, "secs");
});
