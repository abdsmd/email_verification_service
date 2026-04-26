import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { BatchVerifyRequestSchema, VerificationResultSchema } from "../types/api.types.js";
import { runBatchVerify } from "../services/batch-verify.service.js";
import { getLogger } from "../utils/logger.js";
import { incBatch, incBatchRows } from "../services/metrics.service.js";
import { idempotencyReadPreHandler, idempotencyStoreSuccessIfNeeded } from "../middleware/idempotency.middleware.js";

const log = getLogger();

export function registerBatchRoutes(app: FastifyInstance): void {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = BatchVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    incBatch(request.tenantId);
    incBatchRows(request.tenantId, parsed.data.items.length);
    try {
      const results = await runBatchVerify(parsed.data);
      const out = { results: results.map((r) => VerificationResultSchema.parse(r)) };
      await idempotencyStoreSuccessIfNeeded(request, 200, out);
      return out;
    } catch (e) {
      log.error({ err: e }, "batch: unexpected top-level failure");
      return reply.status(500).send({ error: "internal_error" });
    }
  };
  app.post("/v1/verify/batch", { preHandler: [idempotencyReadPreHandler] }, handler);
}
