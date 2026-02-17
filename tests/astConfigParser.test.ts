import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";
import { parseConfigWithAst } from "../src/astConfigParser";

const FIXTURES = path.join(__dirname, "fixtures");

describe("parseConfigWithAst", () => {
  it("parses complex config with computed values", () => {
    const configPath = path.join(FIXTURES, "complex-config-repo", "playwright.config.ts");
    const content = fs.readFileSync(configPath, "utf8");
    const result = parseConfigWithAst(configPath, content);

    expect(result).toBeDefined();
    expect(result!.testDir).toBe("./tests/e2e");
    // 60 * 1000 = 60000
    expect(result!.timeoutMs).toBe(60000);
    // 2 * 60 * 1000 = 120000
    expect(result!.expectTimeoutMs).toBe(120000);
    // globalSetup via require.resolve
    expect(result!.globalSetup).toBe("./global-setup");
  });

  it("parses use block properties", () => {
    const configPath = path.join(FIXTURES, "complex-config-repo", "playwright.config.ts");
    const content = fs.readFileSync(configPath, "utf8");
    const result = parseConfigWithAst(configPath, content);

    expect(result).toBeDefined();
    expect(result!.use).toBeDefined();
    // 30 * 1000 = 30000
    expect(result!.use!.actionTimeoutMs).toBe(30000);
    expect(result!.use!.trace).toBe("retain-on-failure");
    expect(result!.use!.video).toBe("on-first-retry");
    expect(result!.use!.screenshot).toBe("only-on-failure");
    expect(result!.use!.ignoreHTTPSErrors).toBe(true);
  });

  it("captures ternary expression for retries as raw text", () => {
    const configPath = path.join(FIXTURES, "complex-config-repo", "playwright.config.ts");
    const content = fs.readFileSync(configPath, "utf8");
    const result = parseConfigWithAst(configPath, content);

    expect(result).toBeDefined();
    // Ternary: process.env.CI ? 2 : 0
    expect(result!.retries).toBeDefined();
    expect(result!.retries).toContain("process.env.CI");
  });

  it("captures workers expression as string", () => {
    const configPath = path.join(FIXTURES, "complex-config-repo", "playwright.config.ts");
    const content = fs.readFileSync(configPath, "utf8");
    const result = parseConfigWithAst(configPath, content);

    expect(result).toBeDefined();
    // process.env.CI ? 4 : 2
    expect(result!.workers).toBeDefined();
    expect(result!.workers).toContain("process.env.CI");
  });

  it("parses projects array", () => {
    const configPath = path.join(FIXTURES, "complex-config-repo", "playwright.config.ts");
    const content = fs.readFileSync(configPath, "utf8");
    const result = parseConfigWithAst(configPath, content);

    expect(result).toBeDefined();
    expect(result!.projects).toBeDefined();
    expect(result!.projects!.length).toBe(3);
    expect(result!.projects!.map((p) => p.name)).toEqual(["chromium", "firefox", "mobile-chrome"]);
  });

  it("parses reporter array", () => {
    const configPath = path.join(FIXTURES, "complex-config-repo", "playwright.config.ts");
    const content = fs.readFileSync(configPath, "utf8");
    const result = parseConfigWithAst(configPath, content);

    expect(result).toBeDefined();
    expect(result!.reporters).toBeDefined();
    expect(result!.reporters!.length).toBeGreaterThanOrEqual(2);
    const names = result!.reporters!.map((r) => r.name);
    expect(names).toContain("html");
    expect(names).toContain("junit");
  });

  it("parses variables referenced in config (BASE_TIMEOUT, EXPECT_TIMEOUT)", () => {
    const source = `
import { defineConfig } from "@playwright/test";
const MY_TIMEOUT = 45 * 1000;
export default defineConfig({
  timeout: MY_TIMEOUT,
  testDir: "./src/tests",
});
    `.trim();
    const result = parseConfigWithAst("test.config.ts", source);

    expect(result).toBeDefined();
    expect(result!.timeoutMs).toBe(45000);
    expect(result!.testDir).toBe("./src/tests");
  });

  it("handles satisfies keyword", () => {
    const source = `
import type { PlaywrightTestConfig } from "@playwright/test";
export default {
  timeout: 30000,
  retries: 1,
  use: {
    trace: "on",
    baseURL: "http://localhost:8080",
  },
} satisfies PlaywrightTestConfig;
    `.trim();
    const result = parseConfigWithAst("test.config.ts", source);

    expect(result).toBeDefined();
    expect(result!.timeoutMs).toBe(30000);
    expect(result!.retries).toBe("1");
    expect(result!.use?.trace).toBe("on");
    expect(result!.use?.baseURL).toBe("http://localhost:8080");
  });

  it("returns undefined for non-config files", () => {
    const source = `
const x = 42;
console.log("hello");
    `.trim();
    const result = parseConfigWithAst("random.ts", source);
    expect(result).toBeUndefined();
  });

  it("handles empty defineConfig", () => {
    const source = `
import { defineConfig } from "@playwright/test";
export default defineConfig({});
    `.trim();
    const result = parseConfigWithAst("test.config.ts", source);
    expect(result).toBeDefined();
    expect(result!.configPath).toBe("test.config.ts");
  });
});
