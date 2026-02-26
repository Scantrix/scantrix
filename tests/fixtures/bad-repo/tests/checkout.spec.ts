import { test, expect } from '@playwright/test';

const phoneNumber = '+1-555-123-4567';
const userEmail = 'testuser@example.com';
const userPassword = 'SuperSecret123!';
const firstName = 'John';
const lastName = 'Doe';
const streetAddress = '742 Evergreen Terrace';
const zipCode = '62704';
const birthDate = '03/15/1985';
const cardNumber = '4111-1111-1111-1111';

test('checkout flow', async ({ page }) => {
  await page.goto('https://staging.example.com/checkout');
  await page.fill('#email', userEmail);
  await page.fill('#password', userPassword);
  await page.locator('div > span > div > a > span.text').click();
  await page.locator('.items').first().click();
  await page.locator('li').nth(3).click();
  await page.waitForTimeout(2000);
  await expect(page.locator('.total')).toBeVisible();
});

test('profile update', async ({ page }) => {
  await page.goto('https://staging.example.com/profile');
  await page.fill('#phone', phoneNumber);
  await page.click('button.save', { force: true });
  await page.waitForTimeout(1500);
});

test('data grid interaction', async ({ page }) => {
  await page.goto('https://staging.example.com/data');
  // No assertion — just navigation
});
