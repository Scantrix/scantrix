import { test } from '@playwright/test';
import { compareActualAndExpectedResults, verifyElementState } from '../utils/customAssertions';

test('TC-100001 — verify asset name', async ({ page }) => {
  await page.goto('/assets');
  const text = await page.locator('.asset-name').textContent();
  await compareActualAndExpectedResults(text!, 'My Asset');
});

test('TC-100002 — verify asset state', async ({ page }) => {
  await page.goto('/assets/1');
  await verifyElementState(page.locator('.asset-card'), 'active');
});

test('TC-100003 — verify asset description', async ({ page }) => {
  await page.goto('/assets/1');
  const desc = await page.locator('.description').textContent();
  await compareActualAndExpectedResults(desc!, 'Description text');
  await compareActualAndExpectedResults(desc!, 'Description text');
});
