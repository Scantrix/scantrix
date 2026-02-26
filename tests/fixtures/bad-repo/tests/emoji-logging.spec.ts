import { test, expect } from '@playwright/test';

test('emoji in log messages', async ({ page }) => {
  console.log('✅ Starting test run');
  await page.goto('/dashboard');
  console.warn('⚠️ Slow response detected');
  await expect(page.locator('h1')).toBeVisible();
  console.log('🚀 Navigation complete');
});

test('more emoji logging', async ({ page }) => {
  console.error('❌ Element not found, retrying');
  await page.goto('/settings');
  console.info('📝 Filling form fields');
  await expect(page.locator('form')).toBeVisible();
});
