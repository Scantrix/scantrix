import { test, expect } from '@playwright/test';

test.describe('TC-106752 — Asset management', () => {
  let homePageInternal: any;
  let sharedContext: any;

  test('create asset', async ({ page }) => {
    const homePageInternal = await page.goto('/home');
    const sharedContext = { data: 'test' };
    await expect(page.locator('h1')).toBeVisible();
  });

  test.afterAll(async () => {
    await homePageInternal?.close();
  });
});
