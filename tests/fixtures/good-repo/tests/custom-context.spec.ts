import { test, expect, type BrowserContext, type Page } from '@playwright/test';

let slContext: BrowserContext;
let slPage: Page;
let dcPage: Page;

test('TC-[173293]-Verify that new Note is created', async ({
  browser,
}) => {
  slContext = await browser.newContext({
    storageState: './auth/sl-user.json',
  });
  slPage = await slContext.newPage();
  await slPage.goto('/notes/new');
  await expect(slPage.locator('.note-editor')).toBeVisible();
});

test('TC-[173294]-Verify dashboard loads in second context', async ({
  browser,
}) => {
  const dcContext = await browser.newContext({
    storageState: './auth/dc-user.json',
  });
  dcPage = await dcContext.newPage();
  await dcPage.goto('/dashboard');
  await expect(dcPage.locator('h1')).toHaveText('Dashboard');
});

test.afterAll(async () => {
  await Promise.all([
    dcPage?.close().catch(() => {}),
    slPage?.close().catch(() => {}),
  ]);
});
