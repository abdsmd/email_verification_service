import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { scoreForCode, scoreVerificationResult } from "../src/services/scoring.service.js";
import { resetConfigForTests } from "../src/config/env.js";

describe("scoring", () => {
  it("ranks valid above dead", () => {
    expect(scoreForCode("valid")).toBeGreaterThan(scoreForCode("dead"));
  });

  it("treats undeliverable as hard fail like dead", () => {
    expect(scoreForCode("undeliverable")).toBe(scoreForCode("dead"));
  });
});

describe("scoring role_account mode", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.ROLE_ACCOUNT_DELIVERABILITY;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.ROLE_ACCOUNT_DELIVERABILITY;
    else process.env.ROLE_ACCOUNT_DELIVERABILITY = prev;
    resetConfigForTests();
  });

  it("maps role to undeliverable when configured", () => {
    process.env.ROLE_ACCOUNT_DELIVERABILITY = "undeliverable";
    resetConfigForTests();
    const r = scoreVerificationResult({ email: "a@b.c", code: "role_account", details: {} });
    expect(r.score).toBe(0);
    expect(r.deliverability).toBe("undeliverable");
  });
});
