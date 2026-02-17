import { defineConfig, devices } from "@playwright/test";

const BASE_TIMEOUT = 60 * 1000;
const EXPECT_TIMEOUT = 2 * 60 * 1000;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: BASE_TIMEOUT,
  expect: {
    timeout: EXPECT_TIMEOUT,
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : 2,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "test-results/results.xml" }],
  ],
  use: {
    baseURL: process.env.BASE_URL || "https://staging.example.com",
    trace: "retain-on-failure",
    video: "on-first-retry",
    screenshot: "only-on-failure",
    headless: !process.env.HEADLESS_MODE
      ? true
      : process.env.HEADLESS_MODE === "true",
    actionTimeout: 30 * 1000,
    ignoreHTTPSErrors: true,
    launchOptions: {
      args: ["--disable-gpu", "--no-sandbox"],
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"], isMobile: true },
    },
  ],
  globalSetup: require.resolve("./global-setup"),
});
