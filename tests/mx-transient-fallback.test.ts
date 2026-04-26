import { describe, it, expect } from "vitest";
import { canTryAnotherMxForTransient, isTransientRcptSuitableForNextMx } from "../src/utils/mx-transient-fallback.js";
import type { RcptResult } from "../src/types/smtp.types.js";

const transientRcpt: RcptResult = {
  kind: "rcpt",
  class: "temporary",
  text: "451 defer",
  code: 451,
  providerBlock: false,
  semantic: "temp_mailbox",
};

const goodRcpt: RcptResult = {
  kind: "rcpt",
  class: "accept",
  text: "250",
  code: 250,
  providerBlock: false,
  semantic: "mailbox_ok",
};

describe("mx-transient-fallback", () => {
  it("detects transient rcpt for next-mx try", () => {
    expect(isTransientRcptSuitableForNextMx(transientRcpt)).toBe(true);
    expect(isTransientRcptSuitableForNextMx(goodRcpt)).toBe(false);
  });

  it("canTryAnotherMxForTransient enforces cap", () => {
    expect(
      canTryAnotherMxForTransient({ mxi: 0, mxCount: 3, extraTriesSoFar: 0, maxExtra: 1 })
    ).toBe(true);
    expect(
      canTryAnotherMxForTransient({ mxi: 1, mxCount: 3, extraTriesSoFar: 0, maxExtra: 1 })
    ).toBe(true);
    expect(
      canTryAnotherMxForTransient({ mxi: 0, mxCount: 1, extraTriesSoFar: 0, maxExtra: 1 })
    ).toBe(false);
    expect(
      canTryAnotherMxForTransient({ mxi: 0, mxCount: 3, extraTriesSoFar: 1, maxExtra: 1 })
    ).toBe(false);
  });
});
