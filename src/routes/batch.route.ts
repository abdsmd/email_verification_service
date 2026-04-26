import type { FastifyInstance } from "fastify";
import { BatchVerifyRequestSchema, VerificationResultSchema } from "../types/api.types.js";
import { runBatchVerify } from "../services/batch-verify.service.js";
import { getLogger } from "../utils/logger.js";
import { incBatch } from "../services/metrics.service.js";

const log = getLogger();

export function registerBatchRoutes(app: FastifyInstance): void {
  app.post("/v1/verify/batch", async (request, reply) => {
    const parsed = BatchVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    incBatch();
    try {
      const results = await runBatchVerify(parsed.data);
      return { results: results.map((r) => VerificationResultSchema.parse(r)) };
    } catch (e) {
      log.error({ err: e }, "batch: unexpected top-level failure");
      return reply.status(500).send({ error: "internal_error" });
    }
  });
}
