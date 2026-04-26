import { describe, it, expect, beforeEach } from "vitest";
import { resetConfigForTests } from "../src/config/env.js";
import {
  getAllCooldowns,
  markProviderCooling,
  providerSmtpAllowNow,
  recordProviderSmtpUse,
  resetProviderStateForTests,
} from "../src/services/provider-cooldown.service.js";

beforeEach(() => {
  process.env.PROVIDER_COOLDOWN_ENABLED = "true";
  process.env.BIG_PROVIDER_SMTP_MIN_INTERVAL_MS = "0";
  process.env.MAJOR_FREE_MAIL_PROVIDERS_MIN_INTERVAL_MS = "5000";
  process.env.PROVIDER_COOLDOWN_PERSIST = "false";
  delete process.env.SQLITE_PATH;
  resetConfigForTests();
  resetProviderStateForTests();
});

describe("provider cooldown backoff", () => {
  it("increments blockCount on each bump (escalation tiers use blockCount in durationForTier)", () => {
    markProviderCooling("gmail", "t1");
    expect(getAllCooldowns().gmail?.blockCount).toBe(1);
    markProviderCooling("gmail", "t2");
    expect(getAllCooldowns().gmail?.blockCount).toBe(2);
    markProviderCooling("gmail", "t3");
    expect(getAllCooldowns().gmail?.blockCount).toBe(3);
  });

  it("applies a higher min interval for Gmail/Outlook/Yahoo when base interval is on", () => {
    process.env.BIG_PROVIDER_SMTP_MIN_INTERVAL_MS = "1000";
    process.env.MAJOR_FREE_MAIL_PROVIDERS_MIN_INTERVAL_MS = "5000";
    resetConfigForTests();
    resetProviderStateForTests();
    recordProviderSmtpUse("gmail");
    const w = providerSmtpAllowNow("gmail");
    expect("waitMs" in w).toBe(true);
    if ("waitMs" in w) {
      expect(w.waitMs).toBeGreaterThanOrEqual(4000);
    }
  });
});
