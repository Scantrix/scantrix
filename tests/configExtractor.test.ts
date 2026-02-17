import { describe, it, expect } from "vitest";
import { evaluateNumericExpression } from "../src/configExtractor";

describe("evaluateNumericExpression", () => {
  it("parses plain numbers", () => {
    expect(evaluateNumericExpression("60000")).toBe(60000);
  });

  it("parses underscore notation", () => {
    expect(evaluateNumericExpression("60_000")).toBe(60000);
  });

  it("parses scientific notation", () => {
    expect(evaluateNumericExpression("6e4")).toBe(60000);
  });

  it("parses multiplication chain", () => {
    expect(evaluateNumericExpression("60 * 1000")).toBe(60000);
  });

  it("parses reversed multiplication", () => {
    expect(evaluateNumericExpression("1000 * 60")).toBe(60000);
  });

  it("parses chained multiplication", () => {
    expect(evaluateNumericExpression("2 * 60 * 1000")).toBe(120000);
  });

  it("returns undefined for non-numeric expressions", () => {
    expect(evaluateNumericExpression("process.env.TIMEOUT")).toBeUndefined();
  });

  it("returns undefined for undefined input", () => {
    expect(evaluateNumericExpression(undefined)).toBeUndefined();
  });
});
