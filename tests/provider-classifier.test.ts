import { describe, it, expect } from "vitest";
import { detectBigProvider } from "../src/services/provider-classifier.service.js";

describe("provider-classifier", () => {
  it("detects Gmail", () => {
    const r = detectBigProvider("gmail.com", "gmail-smtp-in.l.google.com");
    expect(r.isBig).toBe(true);
    expect(r.id).toBe("gmail");
  });
  it("detects Outlook from known consumer domain (MX need not match)", () => {
    const r = detectBigProvider("outlook.com", "mx.example.net");
    expect(r.isBig).toBe(true);
    expect(r.id).toBe("outlook");
  });

  it("returns other for unknown", () => {
    const r = detectBigProvider("acme.corp", "mail.acme.corp");
    expect(r.id).toBe("other");
  });
});
