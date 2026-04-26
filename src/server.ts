import "./config/env.js";
import { registerProcessSafetyHandlers } from "./process-safety.js";
registerProcessSafetyHandlers();

import { getConfig } from "./config/env.js";
import { getLogger } from "./utils/logger.js";
import { buildApp } from "./app.js";
import type { FastifyInstance } from "fastify";
import type { Server as HttpServer } from "node:http";

const config = getConfig();
const log = getLogger();

let app: FastifyInstance;

try {
  app = await buildApp();
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (e) {
  log.fatal({ err: e }, "server failed to start");
  process.exit(1);
}

if (
  config.NODE_ENV === "production" &&
  (config.HOST === "0.0.0.0" || config.HOST === "::")
) {
  log.warn(
    { host: config.HOST },
    "HTTP bound to all interfaces; prefer 127.0.0.1 behind a reverse proxy unless required (e.g. Docker)"
  );
}

log.info(
  {
    port: config.PORT,
    host: config.HOST,
    stationId: config.STATION_ID,
    region: config.STATION_REGION,
  },
  "VerificationStation listening"
);

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log.info({ signal }, "shutdown");
  const grace = getConfig().SHUTDOWN_GRACE_MS;
  const httpServer = app.server as HttpServer;
  const force = setTimeout(() => {
    try {
      if (typeof httpServer.closeAllConnections === "function") {
        httpServer.closeAllConnections();
        log.warn("forced close of remaining HTTP connections after grace period");
      }
    } catch (e) {
      log.error({ err: e }, "closeAllConnections");
    }
  }, grace);
  try {
    await app.close();
  } catch (e) {
    log.error({ err: e }, "close");
  } finally {
    clearTimeout(force);
  }
  process.exit(0);
};

for (const s of ["SIGINT", "SIGTERM"] as const) {
  process.on(s, () => {
    void shutdown(s);
  });
}
