import { describe, it, expect } from "vitest";
import { parseEmail } from "../src/services/syntax.service.js";

describe("parseEmail", () => {
  it("rejects bad syntax", () => {
    expect(parseEmail("").ok).toBe(false);
    expect(parseEmail("a@").ok).toBe(false);
    expect(parseEmail("no-at-sign").ok).toBe(false);
    expect(parseEmail("@@bad").ok).toBe(false);
  });
  it("accepts valid rfc-like local parts and domains", () => {
    const r = parseEmail("user.name+tag@example.com");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.local).toBe("user.name+tag");
      expect(r.value.domain).toBe("example.com");
    }
  });
  it("rejects consecutive dots in local or domain", () => {
    expect(parseEmail("a..b@x.com").ok).toBe(false);
    expect(parseEmail("a@x..com").ok).toBe(false);
  });
});
