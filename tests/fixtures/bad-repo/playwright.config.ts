import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 180000,
  expect: {
    timeout: 30000,
  },
  fullyParallel: true,
  forbidOnly: false,
  retries: process.env.CI ? 3 : 1,
  workers: 1,
  reporter: 'html',
  use: {
    actionTimeout: 60 * 1000,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
