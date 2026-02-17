import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  workers: 1,
  use: {
    ...baseConfig.use,
    headless: false,
    video: "on",
  },
});
