import { describe, it, expect } from "vitest";
import { normalizeMxRecords } from "../src/services/mx.service.js";

describe("MX record normalization (classification input)", () => {
  it("strips trailing dot and sorts by ascending priority", () => {
    const out = normalizeMxRecords([
      { exchange: "b.example.net.", priority: 20 },
      { exchange: "a.example.net", priority: 5 },
    ]);
    expect(out).toEqual([
      { exchange: "a.example.net", priority: 5 },
      { exchange: "b.example.net", priority: 20 },
    ]);
  });
});
