import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getConfig } from "../config/env.js";
import { getLogger } from "../utils/logger.js";
import { HttpErrorStatus } from "../config/status-codes.js";
import { incError } from "../services/metrics.service.js";

const log = getLogger();

/** 404s use the same JSON envelope as the rest of the API (no HTML). */
export function registerNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler(
    (req: FastifyRequest, reply: FastifyReply) => {
      return reply
        .status(404)
        .send({ error: "not_found", method: req.method });
    }
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, _req, reply) => {
    incError();
    log.error({ err }, "unhandled");
    if (err.validation) {
      return reply.status(HttpErrorStatus.BAD_REQUEST).send({
        error: "validation_error",
        message: err.message,
        details: err.validation,
      });
    }
    const status = err.statusCode ?? HttpErrorStatus.INTERNAL;
    if (getConfig().NODE_ENV === "production" && status >= 500) {
      return reply.status(status).send({ error: "internal_error" });
    }
    return reply.status(status).send({
      error: err.name ?? "Error",
      message: err.message,
    });
  });
}
