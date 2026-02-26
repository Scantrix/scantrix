import { test, expect } from '@playwright/test';

test.describe('Visual tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should render main view', async ({ page }) => {
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('should display toolbar', async ({ page }) => {
    await expect(page.getByRole('toolbar')).toBeVisible();
  });
});
