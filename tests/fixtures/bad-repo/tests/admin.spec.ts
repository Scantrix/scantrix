import { test, expect } from '@playwright/test';

test('admin page with inline config', { timeout: 120000 }, async ({ page }) => {
  await page.goto('https://staging.example.com/admin');
  await expect(page.locator('h1')).toHaveText('Admin');
});

test('settings page', async ({ page }) => {
  await page.goto('https://staging.example.com/settings');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#settings-form')).toBeVisible();
});

test('reports page slow', { timeout: 90000 }, async ({ page }) => {
  await page.goto('https://staging.example.com/reports');
  await expect(page.locator('.report-table')).toBeVisible();
});

test('users list', { retries: 5 }, async ({ page }) => {
  await page.goto('https://staging.example.com/users');
  await expect(page.locator('.user-list')).toBeVisible();
});
