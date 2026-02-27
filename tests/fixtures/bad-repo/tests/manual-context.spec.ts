import { test, expect } from '@playwright/test';

test('TC-106752 — multi-context asset test', async ({ browser }) => {
  const ctx1 = await browser.newContext({ storageState: './auth/user1.json' });
  const page1 = await ctx1.newPage();
  await page1.goto('/assets');
  await expect(page1.locator('h1')).toHaveText('Assets');

  const ctx2 = await browser.newContext({ storageState: './auth/user2.json' });
  const page2 = await ctx2.newPage();
  await page2.goto('/dashboard');
  await expect(page2.locator('h1')).toHaveText('Dashboard');
});

test('TC-106753 — single manual context', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: './auth/admin.json' });
  const page = await ctx.newPage();
  await page.goto('/admin');
  await expect(page.locator('h1')).toHaveText('Admin');
});
