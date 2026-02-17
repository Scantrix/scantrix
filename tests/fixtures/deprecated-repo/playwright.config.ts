import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  snapshotDir: './snapshots',
  use: {
    baseURL: 'https://example.com',
    trace: 'retain-on-failure',
  },
});
