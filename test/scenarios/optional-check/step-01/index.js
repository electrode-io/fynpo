module.exports = {
  title: "should fetch optional package to run preinstall script"
};

/*

This test depends on the OS to fail with ENOTFOUND error on the host name, and not trigger a retry with
10 second cool down time.  See index.js in the module make-fetch-happen.

Unfortunately with some firewall software and VPN etc, the OS would return ECONNREFUSED error.  That
causes make-fetch-happen to wait 10 seconds to do retry, and causing the test to fail with timeout.

> dist-fetcher fetch mod-drop-tgz@1.0.1 tarball failed request to http://blahblah.qwerqreqwerqwerqwerqwer.com:9992/mod-drop-tgz/-/mod-drop-tgz-1.0.1.tgz failed, reason: connect ECONNREFUSED 23.202.231.169:9992
> STACK FetchError: request to http://blahblah.qwerqreqwerqwerqwerqwer.com:9992/mod-drop-tgz/-/mod-drop-tgz-1.0.1.tgz failed, reason: connect ECONNREFUSED 23.202.231.169:9992
    at ClientRequest.req.on.err (./node_modules/node-fetch-npm/src/index.js:68:14)
> optional dep check failed mod-drop-tgz@1.0.1 - fetch tarball failed, your install likely will be bad.

*/
