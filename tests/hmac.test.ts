import { describe, it, expect, beforeEach } from "vitest";
import { resetConfigForTests } from "../src/config/env.js";
import {
  parseTimestampToMs,
  buildHmacSignatureBaseString,
  computeHmacSha256Hex,
} from "../src/middleware/hmac.middleware.js";
import { checkAndStoreRequestId, resetHmacReplayCacheForTests } from "../src/services/hmac-replay.service.js";

beforeEach(() => {
  resetConfigForTests();
  resetHmacReplayCacheForTests();
});

describe("HMAC signing helpers", () => {
  it("base string is timestamp + dot + raw body", () => {
    expect(buildHmacSignatureBaseString("1730000000", '{"x":1}')).toBe('1730000000.{"x":1}');
    expect(buildHmacSignatureBaseString("1730000000", "")).toBe("1730000000.");
  });

  it("computes stable hex HMAC-SHA256", () => {
    const base = buildHmacSignatureBaseString("t", "body");
    const a = computeHmacSha256Hex("k", base);
    const b = computeHmacSha256Hex("k", base);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("parses unix seconds, ms, and ISO timestamps", () => {
    const now = Date.now();
    expect(parseTimestampToMs(String(Math.floor(now / 1000)))).toBe(Math.floor(now / 1000) * 1000);
    expect(parseTimestampToMs(String(now))).toBe(now);
    expect(parseTimestampToMs(new Date(now).toISOString())).toBe(now);
  });
});

describe("HMAC request-id replay", () => {
  it("rejects same id after first success", () => {
    expect(checkAndStoreRequestId("rid-1")).toBe("ok");
    expect(checkAndStoreRequestId("rid-1")).toBe("replay");
  });
});
