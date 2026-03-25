import { describe, it, expect } from "vitest";
import { retriesLikelyEnabled } from "../src/scanner";

describe("retriesLikelyEnabled", () => {
  // Literal zero — retries explicitly disabled
  it('returns false for literal "0"', () => {
    expect(retriesLikelyEnabled("0")).toBe(false);
  });

  it("returns false for whitespace-padded zero", () => {
    expect(retriesLikelyEnabled("  0  ")).toBe(false);
  });

  // Numeric ternaries where both branches are 0
  it("returns false for process.env.CI ? 0 : 0", () => {
    expect(retriesLikelyEnabled("process.env.CI ? 0 : 0")).toBe(false);
  });

  it("returns false for condition ? 0 : 0 (generic condition)", () => {
    expect(retriesLikelyEnabled("someFlag ? 0 : 0")).toBe(false);
  });

  // Numeric ternaries where at least one branch is > 0
  it("returns true for process.env.CI ? 2 : 0", () => {
    expect(retriesLikelyEnabled("process.env.CI ? 2 : 0")).toBe(true);
  });

  it("returns true for process.env.CI ? 0 : 3", () => {
    expect(retriesLikelyEnabled("process.env.CI ? 0 : 3")).toBe(true);
  });

  it("returns true for process.env.CI ? 2 : 1 (both non-zero)", () => {
    expect(retriesLikelyEnabled("process.env.CI ? 2 : 1")).toBe(true);
  });

  // Non-zero literals
  it("returns true for literal non-zero number", () => {
    expect(retriesLikelyEnabled("2")).toBe(true);
    expect(retriesLikelyEnabled("3")).toBe(true);
  });

  // Non-numeric ternary (non-simple branch) — preserve existing true behaviour
  it("returns true for ternary with non-numeric branch", () => {
    expect(retriesLikelyEnabled("process.env.CI ? retryCount : 0")).toBe(true);
  });

  // Undefined / empty
  it("returns false when expression is undefined", () => {
    expect(retriesLikelyEnabled(undefined)).toBe(false);
  });
});
