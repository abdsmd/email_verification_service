import type { FastifyInstance, FastifyRequest } from "fastify";
import { CooldownResetRequestSchema } from "../types/api.types.js";
import { getAllCooldowns, resetProviderCooldown } from "../services/provider-cooldown.service.js";

export function registerCooldownRoutes(app: FastifyInstance): void {
  app.get("/v1/cooldown", async () => ({ providers: getAllCooldowns() }));

  app.post("/v1/cooldown/reset", async (request: FastifyRequest, reply) => {
    const parsed = CooldownResetRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    resetProviderCooldown(parsed.data.provider);
    return { ok: true };
  });
}
