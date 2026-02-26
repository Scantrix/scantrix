import { test, expect } from '@playwright/test';

const username = 'testadmin';
const firstName = 'Alice';
const lastName = 'Johnson';
const zipCode = '30301';

test('login with hard wait', async ({ page }) => {
  await page.goto('https://staging.example.com/login');
  await page.waitForTimeout(5000);
  await page.fill('#username', 'admin');
  await page.fill('#password', 'Password123!');
  await page.click('button[type="submit"]', { force: true });
  await page.waitForTimeout(3000);
  await expect(page.locator('.dashboard')).toBeVisible();
});

test('search with xpath', async ({ page }) => {
  await page.goto('https://staging.example.com/search');
  await page.locator('//input[@id=search-box]').fill('test query');
  await page.locator('//button[contains(@class, search-btn)]').click();
  await page.waitForTimeout(2000);
  const results = page.locator('//div[@class=results]//li');
  await expect(results).toHaveCount(5);
});

test('navigate with networkidle', async ({ page }) => {
  await page.goto('https://staging.example.com/dashboard', {
    waitUntil: 'networkidle',
  });
  await expect(page.locator('h1')).toHaveText('Dashboard');
});

test.skip('broken test that nobody fixes', async ({ page }) => {
  await page.goto('https://staging.example.com/broken');
});

test.fixme('known flaky login', async ({ page }) => {
  await page.goto('https://staging.example.com/login');
});

// Test with non-retrying assertions (PW-FLAKE-005)
test('verify dashboard elements', async ({ page }) => {
  await page.goto('https://staging.example.com/dashboard');
  expect(await page.locator('.header').isVisible()).toBe(true);
  expect(await page.locator('.nav').textContent()).toBe('Navigation');
});

// Test with deprecated page.type() (PW-DEPREC-007)
test('search with type', async ({ page }) => {
  await page.goto('https://staging.example.com/search');
  await page.type('#search-input', 'test query');
});

// Test with deprecated layout selectors (PW-DEPREC-008)
test('layout selector usage', async ({ page }) => {
  await page.goto('https://staging.example.com/layout');
  await page.locator('button:right-of(#search)').click();
  await page.locator('div:below(.header)').first();
});

// Test with no assertion at all
test('visit home page', async ({ page }) => {
  await page.goto('https://staging.example.com');
  await page.waitForTimeout(1000);
});

// Debug pause left in committed code (PW-FLAKE-001)
test('debug session leftover', async ({ page }) => {
  await page.goto('https://staging.example.com/debug');
  await page.pause();
  await expect(page.locator('h1')).toBeVisible();
});
