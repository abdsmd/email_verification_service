import { describe, it, expect } from "vitest";
import { computeEmailSignals } from "../src/services/risk-signals.service.js";

describe("computeEmailSignals", () => {
  it("flags high-risk TLD", () => {
    const s = computeEmailSignals("a", "phish.zip");
    expect(s.highRiskTld).toBe(true);
  });

  it("suggests typo target for common misspelling", () => {
    const s = computeEmailSignals("x", "gmai.com");
    expect(s.possibleTypoOf).toBe("gmail.com");
  });

  it("returns empty when no signals", () => {
    expect(computeEmailSignals("a", "example.com")).toEqual({});
  });
});
