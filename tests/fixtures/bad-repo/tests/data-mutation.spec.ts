import { test, expect } from '@playwright/test';
import * as testData from '../test-data/assets';

test('TC-200001 — create asset with mutated data', async ({ page }) => {
  testData.assetPayload.ParentCustomerId = 'custom-parent-123';
  testData.assetPayload.ChildCustomerId = 'custom-child-456';
  testData.assetPayload.AssetName = 'Modified Asset';

  await page.goto('/assets/new');
  await expect(page.locator('h1')).toHaveText('New Asset');
});

test('TC-200002 — update user with mutated data', async ({ page }) => {
  testData.userPayload.Email = 'modified@example.com';

  await page.goto('/users');
  await expect(page.locator('h1')).toHaveText('Users');
});
