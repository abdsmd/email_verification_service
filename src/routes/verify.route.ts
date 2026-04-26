import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { SingleVerifyRequestSchema, VerificationResultSchema } from "../types/api.types.js";
import { safeVerify } from "../services/verification.service.js";
import { getVerifyLimiter } from "../services/concurrency.service.js";
import { incVerify, recordVerifyDuration } from "../services/metrics.service.js";
import { getLogger } from "../utils/logger.js";
import { idempotencyReadPreHandler, idempotencyStoreSuccessIfNeeded } from "../middleware/idempotency.middleware.js";

const log = getLogger();

export function registerVerifyRoutes(app: FastifyInstance): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = SingleVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { email, options } = parsed.data;
    incVerify(request.tenantId);
    const t0 = Date.now();
    try {
      const result = await getVerifyLimiter()(() => safeVerify(email, options ?? {}));
      const v = VerificationResultSchema.parse(result);
      await idempotencyStoreSuccessIfNeeded(request, 200, v);
      recordVerifyDuration(request.tenantId, v.durationMs ?? Date.now() - t0);
      return v;
    } catch (e) {
      log.error({ err: e, path: request.url }, "verify route failed");
      return reply.status(500).send({ error: "internal_error" });
    }
  };
  app.post("/v1/verify", { preHandler: [idempotencyReadPreHandler] }, handler);
}
