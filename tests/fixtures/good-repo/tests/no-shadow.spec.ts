import { test, expect } from '@playwright/test';

test.describe('Clean scoping', () => {
  let sharedPage: any;

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext();
    sharedPage = await ctx.newPage();
  });

  test('uses shared variable correctly', async () => {
    await sharedPage.goto('/dashboard');
    await expect(sharedPage.locator('h1')).toBeVisible();
  });

  test.afterAll(async () => {
    await sharedPage?.close();
  });
});
