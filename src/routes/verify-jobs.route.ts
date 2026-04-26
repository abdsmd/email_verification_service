import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { AsyncVerifyJobRequestSchema, VerificationResultSchema } from "../types/api.types.js";
import { enqueueAsyncVerify, getAsyncJob } from "../services/async-verify-jobs.service.js";
import { incVerify } from "../services/metrics.service.js";

export function registerVerifyJobsRoutes(app: FastifyInstance, enabled: boolean): void {
  if (!enabled) {
    return;
  }
  app.post("/v1/verify/jobs", async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = AsyncVerifyJobRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "validation_error", details: parsed.error.flatten() });
    }
    const { email, options, callbackUrl } = parsed.data;
    const en = enqueueAsyncVerify(email, options ?? {}, callbackUrl);
    if ("error" in en) {
      return reply.status(503).send({ error: "queue_full", message: "Async job store is at capacity" });
    }
    incVerify(request.tenantId);
    const { job } = en;
    return reply.status(202).send({ jobId: job.id, status: job.status, createdAt: job.createdAt });
  });

  app.get("/v1/verify/jobs/:id", (request: FastifyRequest, reply: FastifyReply) => {
    const id = (request.params as { id: string }).id;
    if (!/^[a-f0-9]{32}$/i.test(id)) {
      return reply.status(400).send({ error: "validation_error", message: "Invalid job id" });
    }
    const j = getAsyncJob(id);
    if (!j) {
      return reply.status(404).send({ error: "not_found", message: "Job not found" });
    }
    if (j.status === "pending" || j.status === "processing") {
      return { jobId: j.id, status: j.status, createdAt: j.createdAt };
    }
    if (j.status === "failed") {
      return {
        jobId: j.id,
        status: j.status,
        createdAt: j.createdAt,
        error: j.errorMessage,
      };
    }
    const r = j.result ? VerificationResultSchema.parse(j.result) : undefined;
    return { jobId: j.id, status: j.status, createdAt: j.createdAt, result: r };
  });
}
