import type { FastifyRequest, FastifyReply } from "fastify";
import { requestPath } from "../utils/request-path.js";
import {
  buildIdempotencyKey,
  getIdempotentResponse,
  setIdempotentResponse,
} from "../services/idempotency.service.js";

/**
 * Caches **successful** 200 JSON responses for POST verify/batch when `X-Idempotency-Key` is set.
 * Must run after auth (tenant on request).
 */
export async function idempotencyReadPreHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const p = requestPath(request.url);
  if (p !== "/v1/verify" && p !== "/v1/verify/batch" && p !== "/v1/verify/jobs") {
    return;
  }
  const raw = request.headers["x-idempotency-key"];
  if (raw === undefined || raw === null) {
    return;
  }
  if (typeof raw !== "string" || raw.length < 8 || raw.length > 128) {
    return reply
      .status(400)
      .send({ error: "validation_error", message: "X-Idempotency-Key must be 8–128 characters" });
  }
  const tenant = request.tenantId ?? "anonymous";
  const key = buildIdempotencyKey(tenant, raw, p, request.rawBody ?? "");
  const hit = await getIdempotentResponse(key);
  if (hit) {
    reply.status(hit.statusCode);
    return reply.type("application/json").send(JSON.parse(hit.payload));
  }
  request._idempotencyKey = key;
}

export async function idempotencyStoreSuccessIfNeeded(
  request: FastifyRequest,
  status: number,
  payload: unknown
): Promise<void> {
  if (status !== 200) {
    return;
  }
  const k = request._idempotencyKey;
  if (!k) {
    return;
  }
  await setIdempotentResponse(k, 200, payload);
}
