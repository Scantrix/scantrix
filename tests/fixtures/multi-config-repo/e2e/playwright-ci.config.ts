import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  workers: 2,
  retries: 2,
  use: {
    ...baseConfig.use,
    headless: true,
  },
});
