import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetConfigForTests } from "../src/config/env.js";
import { resetProviderStateForTests } from "../src/services/provider-cooldown.service.js";
import { resetMemoryCachesForTests } from "../src/repositories/memory-cache.repository.js";
import { resetMetricsForTests } from "../src/services/metrics.service.js";
import { resetLimiterForTests } from "../src/services/concurrency.service.js";
import { resetProviderSmtpConcurrencyForTests } from "../src/services/provider-smtp-concurrency.service.js";

beforeEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = "test";
  process.env.CACHE_BACKEND = "memory";
  process.env.METRICS_ENABLED = "true";
  delete process.env.STATION_SECRET;
  delete process.env.API_KEY;
  delete process.env.HMAC_SECRET;
  delete process.env.SQLITE_PATH;
  delete process.env.PWA_ENABLED;
  resetConfigForTests();
  resetProviderStateForTests();
  resetMemoryCachesForTests();
  resetMetricsForTests();
  resetLimiterForTests();
  resetProviderSmtpConcurrencyForTests();
});

describe("HTTP JSON contract", () => {
  it("serves health and readiness as JSON objects with stable keys", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const health = await app.inject({ method: "GET", url: "/health" });
      expect(health.statusCode).toBe(200);
      expect(health.headers["content-type"]?.includes("json")).toBe(true);
      expect(health.json()).toEqual({ ok: true, service: "verification-station" });

      const ready = await app.inject({ method: "GET", url: "/v1/ready" });
      expect(ready.statusCode).toBe(200);
      expect(ready.json()).toEqual({ ready: true });
    } finally {
      await app.close();
    }
  });

  it("serves GET /manual-verify as HTML even when PWA_ENABLED=false", async () => {
    process.env.PWA_ENABLED = "false";
    resetConfigForTests();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const root = await app.inject({ method: "GET", url: "/" });
      expect(root.statusCode).toBe(404);

      const res = await app.inject({ method: "GET", url: "/manual-verify" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]?.includes("text/html")).toBe(true);
      expect(res.body).toContain("Manual email verification");
    } finally {
      await app.close();
    }
  });

  it("returns structured JSON for unknown routes (no HTML 404)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/this-route-does-not-exist" });
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]?.includes("json")).toBe(true);
      expect(res.json()).toEqual({ error: "not_found", method: "GET" });
    } finally {
      await app.close();
    }
  });

  it("returns validation_error for invalid verify body", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/v1/verify",
        headers: { "content-type": "application/json" },
        payload: { email: 123 },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { error: string };
      expect(body.error).toBe("validation_error");
    } finally {
      await app.close();
    }
  });

  it("returns metrics JSON when enabled", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/v1/metrics" });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      expect(typeof body).toBe("object");
      expect(body).not.toHaveProperty("error");
    } finally {
      await app.close();
    }
  });
});
