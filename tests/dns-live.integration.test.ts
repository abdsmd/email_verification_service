import { describe, it, expect, beforeEach } from "vitest";
import { resetConfigForTests } from "../src/config/env.js";
import { resetMemoryCachesForTests } from "../src/repositories/memory-cache.repository.js";

const runLive = process.env.LIVE_NETWORK === "1" || process.env.CI_INTEGRATION === "1";

/**
 * Real DNS via Node `dns.promises` — opt-in so CI/offline `npm test` stays deterministic.
 * Run: `LIVE_NETWORK=1 npm test` (Unix) or `set LIVE_NETWORK=1&& npm test` (Windows cmd).
 */
describe.skipIf(!runLive)("live DNS (lookupMx)", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.CACHE_BACKEND = "memory";
    process.env.DNS_TIMEOUT_MS = "10000";
    resetConfigForTests();
    resetMemoryCachesForTests();
  });

  it("resolves MX for a stable public domain", async () => {
    const { lookupMx } = await import("../src/services/mx.service.js");
    const r = await lookupMx("google.com", true);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.records.length).toBeGreaterThan(0);
      expect(r.records[0]!.exchange).toMatch(/google/i);
    }
  });
});
