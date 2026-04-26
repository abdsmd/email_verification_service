import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getConfig } from "../config/env.js";
import { getTenantUsage } from "../services/metrics.service.js";

export function registerUsageRoute(app: FastifyInstance): void {
  app.get("/v1/usage", (request: FastifyRequest, reply: FastifyReply) => {
    if (!getConfig().METRICS_ENABLED) {
      return reply.status(404).send({ error: "usage_unavailable", message: "Metrics disabled" });
    }
    const tid = request.tenantId ?? "default";
    const u = getTenantUsage(tid);
    if (!u) {
      return reply.status(503).send({ error: "usage_unavailable" });
    }
    return u;
  });
}
