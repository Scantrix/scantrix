import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  retries: parseInt(process.env.RETRIES!, 10),
  use: {
    baseURL: "http://localhost:3000",
    actionTimeout: 10_000,
  },
});
