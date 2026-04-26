import type { FastifyInstance } from "fastify";
import { SingleVerifyRequestSchema, VerificationResultSchema } from "../types/api.types.js";
import { safeVerify } from "../services/verification.service.js";
import { getVerifyLimiter } from "../services/concurrency.service.js";
import { incVerify } from "../services/metrics.service.js";
import { getLogger } from "../utils/logger.js";

const log = getLogger();

export function registerVerifyRoutes(app: FastifyInstance): void {
  app.post("/v1/verify", async (request, reply) => {
    const parsed = SingleVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { email, options } = parsed.data;
    incVerify();
    try {
      const result = await getVerifyLimiter()(() => safeVerify(email, options ?? {}));
      return VerificationResultSchema.parse(result);
    } catch (e) {
      log.error({ err: e, path: request.url }, "verify route failed");
      return reply.status(500).send({ error: "internal_error" });
    }
  });
}
