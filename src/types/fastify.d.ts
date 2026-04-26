import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    /** Logical tenant (API key) id for rate limits and usage metrics; set after successful Bearer auth. */
    tenantId?: string;
    /** Max requests per `RATE_LIMIT_WINDOW_MS` for this tenant. */
    tenantRateMax?: number;
    /** Internal: idempotency storage key when `X-Idempotency-Key` is present. */
    _idempotencyKey?: string;
  }
}
