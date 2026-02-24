import { test, expect } from '@playwright/test';

test('verify entire dashboard page', async ({ page }) => {
  await page.goto('https://staging.example.com/dashboard');
  await expect(page.locator('.header')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.main-content')).toBeVisible();
  await expect(page.locator('.footer')).toBeVisible();
  await expect(page.locator('.user-name')).toHaveText('Admin');
  await expect(page.locator('.notification-count')).toHaveText('3');
  await expect(page.locator('.logo')).toBeVisible();
  await expect(page.locator('.nav-links')).toHaveCount(5);
});

test('verify settings page completely', async ({ page }) => {
  await page.goto('https://staging.example.com/settings');
  await expect(page.locator('#email-field')).toBeVisible();
  await expect(page.locator('#name-field')).toBeVisible();
  await expect(page.locator('#phone-field')).toBeVisible();
  await expect(page.locator('#timezone-select')).toBeVisible();
  await expect(page.locator('#language-select')).toBeVisible();
  await expect(page.locator('#theme-toggle')).toBeVisible();
  await expect(page.locator('.save-button')).toBeEnabled();
  await expect(page.locator('.cancel-button')).toBeEnabled();
});

test('verify profile page completely', async ({ page }) => {
  await page.goto('https://staging.example.com/profile');
  await expect(page.locator('.avatar')).toBeVisible();
  await expect(page.locator('.display-name')).toHaveText('Admin User');
  await expect(page.locator('.email')).toHaveText('admin@example.com');
  await expect(page.locator('.role')).toHaveText('Administrator');
  await expect(page.locator('.joined-date')).toBeVisible();
  await expect(page.locator('.edit-button')).toBeEnabled();
});

test('simple focused test', async ({ page }) => {
  await page.goto('https://staging.example.com/about');
  await expect(page.locator('h1')).toBeVisible();
});
