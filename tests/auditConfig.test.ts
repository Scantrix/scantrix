import { describe, it, expect } from "vitest";
import { generateDefaultConfig } from "../src/auditConfig";

describe("generateDefaultConfig", () => {
  it("returns valid JSON", () => {
    const raw = generateDefaultConfig();
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("includes $schema field", () => {
    const config = JSON.parse(generateDefaultConfig());
    expect(config.$schema).toContain("scantrix.com");
  });

  it("has empty disabled rules array", () => {
    const config = JSON.parse(generateDefaultConfig());
    expect(config.rules.disabled).toEqual([]);
  });

  it("has empty severityOverrides object", () => {
    const config = JSON.parse(generateDefaultConfig());
    expect(config.rules.severityOverrides).toEqual({});
  });

  it("includes default exclude globs", () => {
    const config = JSON.parse(generateDefaultConfig());
    expect(config.exclude).toContain("node_modules/**");
    expect(config.exclude).toContain("dist/**");
    expect(config.exclude).toContain("coverage/**");
  });

  it("includes default thresholds", () => {
    const config = JSON.parse(generateDefaultConfig());
    expect(config.thresholds.gradeA).toBe(20);
    expect(config.thresholds.gradeB).toBe(50);
    expect(config.thresholds.gradeC).toBe(85);
  });

  it("includes _comments documentation section", () => {
    const config = JSON.parse(generateDefaultConfig());
    expect(config._comments).toBeDefined();
    expect(config._comments.disabled).toBeDefined();
    expect(config._comments.thresholds).toBeDefined();
  });

  it("ends with a newline", () => {
    const raw = generateDefaultConfig();
    expect(raw.endsWith("\n")).toBe(true);
  });
});
