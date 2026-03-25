import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'https://staging.example.com',
    trace: 'on-first-retry',
  },
});
