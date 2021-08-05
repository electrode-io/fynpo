/* eslint-disable @typescript-eslint/no-var-requires */

const fastifyServer = require("@xarc/fastify-server");

const metaMemoize = {};

/**
 * Start a local server to help multiple fyn installs to communicate
 * with each other to indicate that a package's meta was already retrieved
 * and its cache can be used directly.
 *
 * @returns fastify server
 */
export async function startMetaMemoizer() {
  const server = await fastifyServer({ deferStart: true, connection: { port: 0 } });

  const handle = (res, key, set) => {
    if (key) {
      if (set) {
        metaMemoize[key] = Date.now();
      }

      if (metaMemoize[key]) {
        return res.code(200).send({ time: metaMemoize[key] });
      }
    }

    return res.code(404).send({ err: "not found" });
  };

  server.route({
    method: "GET",
    path: "/",
    handler: (req, res) => handle(res, req.query.key, false),
  });

  server.route({
    method: "POST",
    path: "/",
    handler: (req, res) => handle(res, req.query.key, true),
  });

  await server.start();

  return server;
}
