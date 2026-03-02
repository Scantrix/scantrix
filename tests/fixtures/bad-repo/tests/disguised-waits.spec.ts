import { test, expect } from '@playwright/test';
import { delay, waitForDataSync, WaiterHelpers } from '../utils/sleepHelper';
import { BaseTest } from '../base-test/baseTest';

const waiter = new WaiterHelpers();

test('uses disguised delay', async ({ page }) => {
  await page.goto('/dashboard');
  await delay(2000);
  await expect(page.locator('.loaded')).toBeVisible();
});

test('uses deceptively named wait', async ({ page }) => {
  await page.goto('/data');
  await waitForDataSync();
  await expect(page.locator('.synced')).toBeVisible();
});

test('uses class method delay', async ({ page }) => {
  await page.goto('/settings');
  await waiter.delay(2000);
  await expect(page.locator('.ready')).toBeVisible();
});

test('uses transitive class method delay via BaseTest', async ({ page }) => {
  const baseTest = new BaseTest(page);
  await baseTest.waiterHelpers.delay(500);
  await expect(page.locator('.ready')).toBeVisible();
});

test('uses waitForNetworkIdle wrapper', async ({ page }) => {
  await waiter.waitForIdleNetwork(page);
});
