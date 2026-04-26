import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetConfigForTests } from "../src/config/env.js";
import { resetProviderStateForTests } from "../src/services/provider-cooldown.service.js";
import { resetMemoryCachesForTests } from "../src/repositories/memory-cache.repository.js";
import { resetMetricsForTests } from "../src/services/metrics.service.js";
import { resetLimiterForTests } from "../src/services/concurrency.service.js";

beforeEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = "test";
  process.env.CACHE_BACKEND = "memory";
  delete process.env.STATION_SECRET;
  delete process.env.MAIL_FROM;
  delete process.env.HELO_DOMAIN;
  delete process.env.API_KEY;
  delete process.env.HMAC_SECRET;
  process.env.LOG_FULL_EMAIL = "true";
  resetConfigForTests();
  resetProviderStateForTests();
  resetMemoryCachesForTests();
  resetMetricsForTests();
  resetLimiterForTests();
});

describe("verification-flow smoke", () => {
  it("rejects invalid syntax without network", async () => {
    const { safeVerify } = await import("../src/services/verification.service.js");
    const r = await safeVerify("not-an-email", {});
    expect(r.code).toBe("dead");
  });
});
