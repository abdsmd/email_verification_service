import type { FastifyInstance, FastifyRequest } from "fastify";
import { CacheClearRequestSchema } from "../types/api.types.js";
import { clearCaches, getCacheStats } from "../services/cache.service.js";

export function registerCacheRoutes(app: FastifyInstance): void {
  app.get("/v1/cache/stats", async () => getCacheStats());

  app.post("/v1/cache/clear", async (request: FastifyRequest, reply) => {
    const parsed = CacheClearRequestSchema.safeParse(request.body ?? { type: "all" });
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const t = parsed.data.type ?? "all";
    clearCaches(t);
    return { ok: true, cleared: t };
  });
}
