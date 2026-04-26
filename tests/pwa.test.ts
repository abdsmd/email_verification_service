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

describe("PWA static files", () => {
  it("serves HTML and manifest from ./public when PWA is enabled (default)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const home = await app.inject({ method: "GET", url: "/" });
      expect(home.statusCode).toBe(200);
      expect(home.headers["content-type"]?.includes("text/html")).toBe(true);
      expect(home.body).toContain("Verification Station");

      const man = await app.inject({ method: "GET", url: "/manifest.webmanifest" });
      expect(man.statusCode).toBe(200);
      const m = man.json() as { name: string; display: string };
      expect(m.name).toBe("Verification Station");
      expect(m.display).toBe("standalone");
    } finally {
      await app.close();
    }
  });

  it("does not register PWA routes when PWA_ENABLED=false", async () => {
    process.env.PWA_ENABLED = "false";
    resetConfigForTests();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "not_found", method: "GET" });
    } finally {
      await app.close();
    }
  });
});
