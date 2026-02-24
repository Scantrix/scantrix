import { test, expect, chromium } from '@playwright/test';

test('manual browser launch without cleanup', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://staging.example.com/dashboard');
  await expect(page.locator('.welcome')).toBeVisible();
  // Missing browser.close(), context.close(), page.close()
  // No afterEach/afterAll cleanup
});

test('another leaked browser', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://staging.example.com/settings');
  await expect(page.locator('h1')).toHaveText('Settings');
  // Missing cleanup — browser process will be orphaned
});
