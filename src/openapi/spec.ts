/**
 * OpenAPI 3.0.3 — informational; public contract remains implementation + tests.
 * Version: API path prefix `/v1` (this document; no separate /v2 yet).
 */
export const openApiV1Document: Record<string, unknown> = {
  openapi: "3.0.3",
  info: {
    title: "VerificationStation API",
    version: "1.0.0",
    description:
      "Email verification: syntax, DNS/MX, policy, optional SMTP RCPT. RCPT success does not guarantee inbox delivery. See README and docs/PRODUCT.md.",
  },
  servers: [{ url: "/", description: "Same origin as the station" }],
  tags: [
    { name: "Health", description: "Liveness and readiness" },
    { name: "Verify", description: "Single and batch address checks" },
    { name: "Ops", description: "Cache, cooldown, metrics" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "Same value as STATION_SECRET or API_KEY, or a key from TENANT_KEYS_JSON",
      },
    },
    headers: {
      "X-Idempotency-Key": {
        description: "Optional. Duplicate POST with the same key + body + tenant returns the same 200 (see IDEMPOTENCY_TTL_MS).",
        schema: { type: "string", minLength: 8, maxLength: 128 },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        security: [],
        summary: "Liveness",
        responses: { "200": { description: "OK" } },
      },
    },
    "/v1/ready": {
      get: {
        tags: ["Health"],
        security: [],
        summary: "Readiness",
        responses: { "200": { description: "OK" } },
      },
    },
    "/v1/verify": {
      post: {
        tags: ["Verify"],
        summary: "Verify one email",
        parameters: [
          { name: "X-Idempotency-Key", in: "header", schema: { type: "string" }, required: false },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string" },
                  jobId: { type: "string" },
                  options: {
                    type: "object",
                    properties: {
                      skipSmtp: { type: "boolean" },
                      skipCatchAll: { type: "boolean" },
                      forceRefresh: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Verification result: `code`, optional `score`/`deliverability`, `explain`/`confidence` (when `VERIFICATION_EXPLAIN_ENABLED`), optional `signals` (e.g. high-risk TLD, possible typo) when `VERIFICATION_SIGNALS_ENABLED`",
          },
        },
      },
    },
    "/v1/verify/batch": {
      post: {
        tags: ["Verify"],
        summary: "Verify many addresses",
        parameters: [
          { name: "X-Idempotency-Key", in: "header", schema: { type: "string" }, required: false },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["items"],
                properties: { items: { type: "array" }, options: { type: "object" } },
              },
            },
          },
        },
        responses: { "200": { description: "Array of per-row results" } },
      },
    },
    "/v1/metrics": {
      get: {
        tags: ["Ops"],
        security: [],
        summary: "Counters and latency histogram (when enabled)",
        responses: { "200": { description: "JSON metrics" } },
      },
    },
    "/v1/usage": {
      get: {
        tags: ["Ops"],
        summary: "Per-tenant usage (same counters as /v1/metrics, scoped) when metrics enabled",
        responses: { "200": { description: "postVerify, postBatch, batchRows" } },
      },
    },
    "/v1/verify/jobs": {
      post: {
        tags: ["Verify"],
        summary: "Async single verify (202 + jobId) when ASYNC_VERIFY_JOBS_ENABLED",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string" },
                  jobId: { type: "string" },
                  callbackUrl: { type: "string" },
                  options: { type: "object" },
                },
              },
            },
          },
        },
        responses: { "202": { description: "Job accepted" }, "503": { description: "Queue full" } },
      },
    },
    "/v1/verify/jobs/{id}": {
      get: {
        tags: ["Verify"],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        summary: "Poll async job",
        responses: { "200": { description: "Status and result or error" } },
      },
    },
  },
};
