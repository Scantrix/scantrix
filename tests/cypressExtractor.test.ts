import { describe, it, expect } from "vitest";
import path from "path";
import { extractCypressConfig } from "../src/cypressExtractor";

const FIXTURES = path.join(__dirname, "fixtures");

describe("extractCypressConfig", () => {
  it("parses cypress.config.ts with defineConfig", async () => {
    const result = await extractCypressConfig(path.join(FIXTURES, "cypress-repo"));

    expect(result).toBeDefined();
    expect(result!.configFormat).toBe("ts");
    expect(result!.baseUrl).toBe("http://localhost:3000");
    expect(result!.specPattern).toBe("cypress/e2e/**/*.cy.{js,jsx,ts,tsx}");
    expect(result!.defaultCommandTimeout).toBe(10000);
    expect(result!.requestTimeout).toBe(10000);
    expect(result!.responseTimeout).toBe(30000);
    expect(result!.pageLoadTimeout).toBe(60000);
    expect(result!.viewportWidth).toBe(1280);
    expect(result!.viewportHeight).toBe(720);
    expect(result!.video).toBe(false);
    expect(result!.screenshotOnRunFailure).toBe(true);
    expect(result!.retries?.runMode).toBe(2);
    expect(result!.retries?.openMode).toBe(0);
  });

  it("parses cypress.config.ts without baseUrl", async () => {
    const result = await extractCypressConfig(path.join(FIXTURES, "cypress-nobaseurl-repo"));

    expect(result).toBeDefined();
    expect(result!.configFormat).toBe("ts");
    expect(result!.baseUrl).toBeUndefined();
    expect(result!.defaultCommandTimeout).toBe(45000);
    expect(result!.viewportWidth).toBe(1920);
    expect(result!.viewportHeight).toBe(1080);
    expect(result!.video).toBe(true);
  });

  it("returns undefined for non-Cypress repos", async () => {
    const result = await extractCypressConfig(path.join(FIXTURES, "good-repo"));
    expect(result).toBeUndefined();
  });
});
