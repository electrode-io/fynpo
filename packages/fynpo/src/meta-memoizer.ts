/* eslint-disable @typescript-eslint/no-var-requires */

import http from "http";

const metaMemoize = {};

type Server = http.Server & {
  info: { port: number };
};

/**
 * Start a local server to help multiple fyn installs to communicate
 * with each other to indicate that a package's meta was already retrieved
 * and its cache can be used directly.
 *
 * @returns simple HTTP server
 */
export async function startMetaMemoizer(): Promise<Server> {
  const handle = (res: http.ServerResponse, key: string, set: boolean) => {
    if (key) {
      if (set) {
        metaMemoize[key] = Date.now();
      }

      if (metaMemoize[key]) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ time: metaMemoize[key] }));
      }
    }

    res.writeHead(404, { "content-type": "application/json" });

    return res.end(JSON.stringify({ err: "not found" }));
  };

  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    const method = req.method.toUpperCase();
    const { searchParams } = new URL(req.headers.host + req.url);
    const key = searchParams.get("key");

    handle(res, key, method === "POST");
  });

  const port: number = await new Promise((resolve) => {
    server.listen(0, () => resolve((server.address() as any).port));
  });

  const server2 = server as Server;
  server2.info = { port };

  return server2;
}
