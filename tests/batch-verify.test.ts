import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runBatchVerify } from "../src/services/batch-verify.service.js";
import * as verification from "../src/services/verification.service.js";
import { resetConfigForTests, getConfig } from "../src/config/env.js";
import { resetLimiterForTests } from "../src/services/concurrency.service.js";
import { BatchVerifyRequestSchema } from "../src/types/api.types.js";

vi.mock("../src/services/verification.service.js", () => ({
  safeVerify: vi.fn(),
}));

describe("runBatchVerify", () => {
  beforeEach(() => {
    resetConfigForTests();
    resetLimiterForTests();
    vi.mocked(verification.safeVerify).mockReset();
    vi.mocked(verification.safeVerify).mockImplementation(async (email: string) => ({
      email,
      code: "valid" as const,
      message: "ok",
    }));
  });

  it("deduplicates by email and returns one result per row", async () => {
    const r = await runBatchVerify({
      items: [
        { email: "a@dedupe.test", options: {} },
        { email: "a@dedupe.test", options: { skipSmtp: true } },
      ],
      options: {},
    });
    expect(verification.safeVerify).toHaveBeenCalledTimes(1);
    expect(r).toHaveLength(2);
    expect(r[0]!.code).toBe("valid");
    expect(r[1]!.code).toBe("valid");
    expect(r[0]!.email).toBe("a@dedupe.test");
  });

  it("maps async rejection to system_error without throwing", async () => {
    vi.mocked(verification.safeVerify).mockRejectedValue(new Error("simulated transport failure"));
    const r = await runBatchVerify({
      items: [{ email: "x@rejection.test" }],
      options: {},
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.code).toBe("system_error");
    expect(r[0]!.message).toContain("simulated");
  });

  it("returns partial success when one address fails: others stay valid, failed row is system_error", async () => {
    const seen = new Set<string>();
    vi.mocked(verification.safeVerify).mockImplementation(async (email: string) => {
      seen.add(email);
      if (email === "bad@p.test") {
        throw new Error("one bad");
      }
      return { email, code: "valid" as const, message: "ok" };
    });
    const r = await runBatchVerify({
      items: [
        { email: "a@d1.test" },
        { email: "b@d2.test" },
        { email: "bad@p.test" },
      ],
      options: {},
    });
    expect(r).toHaveLength(3);
    expect(r[0]!.code).toBe("valid");
    expect(r[1]!.code).toBe("valid");
    expect(r[2]!.code).toBe("system_error");
  });
});

describe("BatchVerifyRequestSchema", () => {
  let savedBatchMax: string | undefined;

  beforeEach(() => {
    savedBatchMax = process.env.BATCH_MAX_ITEMS;
  });

  afterEach(() => {
    if (savedBatchMax === undefined) delete process.env.BATCH_MAX_ITEMS;
    else process.env.BATCH_MAX_ITEMS = savedBatchMax;
    resetConfigForTests();
  });

  it("rejects more items than BATCH_MAX_ITEMS (Zod)", () => {
    process.env.BATCH_MAX_ITEMS = "2";
    resetConfigForTests();
    expect(getConfig().BATCH_MAX_ITEMS).toBe(2);
    const p = BatchVerifyRequestSchema.safeParse({
      items: [
        { email: "a1@z.test" },
        { email: "a2@z.test" },
        { email: "a3@z.test" },
      ],
      options: {},
    });
    expect(p.success).toBe(false);
  });
});
