import { describe, it, expect, beforeEach } from "vitest";
import { resetConfigForTests } from "../src/config/env.js";
import {
  recordMxPathFailure,
  resetMxFailureTrackerForTests,
} from "../src/services/mx-failure-tracker.service.js";

beforeEach(() => {
  process.env.NODE_ENV = "test";
  resetConfigForTests();
  resetMxFailureTrackerForTests();
  process.env.MX_PERSISTENT_FAILURE_THRESHOLD = "3";
  process.env.MX_PERSISTENT_FAILURE_WINDOW_MS = "3600000";
  resetConfigForTests();
});

describe("mx-failure-tracker", () => {
  it("does not count smtp_timeout toward persistent", () => {
    const r1 = recordMxPathFailure("example.com", "smtp_timeout");
    expect(r1.persistent).toBe(false);
    const r2 = recordMxPathFailure("example.com", "smtp_timeout");
    expect(r2.persistent).toBe(false);
  });

  it("escalates after threshold non-timeout failures", () => {
    expect(recordMxPathFailure("x.com", "smtp").persistent).toBe(false);
    expect(recordMxPathFailure("x.com", "smtp").persistent).toBe(false);
    expect(recordMxPathFailure("x.com", "smtp").persistent).toBe(true);
  });
});
