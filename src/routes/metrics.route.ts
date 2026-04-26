import type { FastifyInstance } from "fastify";
import { getConfig } from "../config/env.js";
import { getMetricsSnapshot } from "../services/metrics.service.js";
export function registerMetricsRoutes(app: FastifyInstance): void {
  app.get("/v1/metrics", async (request, reply) => {
    if (!getConfig().METRICS_ENABLED) {
      return reply.status(404).send({ error: "metrics_disabled" });
    }
    void request;
    return getMetricsSnapshot();
  });
}
