import { test, expect } from '@playwright/test';

// PW-DEPREC-001: Deprecated selector engine methods
test('uses deprecated $', async ({ page }) => {
  await page.goto('/login');
  const submit = await page.$('button[type="submit"]');
  await submit?.click();
});

test('uses deprecated $$', async ({ page }) => {
  await page.goto('/items');
  const items = await page.$$('.item-card');
  expect(items.length).toBeGreaterThan(0);
});

test('uses deprecated $eval', async ({ page }) => {
  await page.goto('/profile');
  const text = await page.$eval('.username', el => el.textContent);
  expect(text).toBe('admin');
});

test('uses deprecated $$eval', async ({ page }) => {
  await page.goto('/products');
  const prices = await page.$$eval('.price', els => els.map(e => e.textContent));
  expect(prices.length).toBeGreaterThan(0);
});

// PW-DEPREC-002: Deprecated page.action(selector) convenience methods
test('uses deprecated page.click', async ({ page }) => {
  await page.goto('/form');
  await page.click('button.submit');
  await page.dblclick('div.editor');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.type('input[name="search"]', 'hello world');
  await page.hover('a.nav-link');
  await page.check('input[type="checkbox"]');
  await page.uncheck('input[type="checkbox"]');
  await page.selectOption('select#country', 'US');
  await page.focus('input[name="name"]');
  await page.press('input[name="search"]', 'Enter');
  await page.tap('button.mobile-menu');
  await page.dispatchEvent('button.submit', 'click');
  await page.setInputFiles('input[type="file"]', 'test.pdf');
  await page.setChecked('input#agree', true);
});

test('uses deprecated page query methods', async ({ page }) => {
  await page.goto('/dashboard');
  const name = await page.getAttribute('input.name', 'value');
  const html = await page.innerHTML('.content');
  const text = await page.innerText('.title');
  const val = await page.inputValue('input.search');
  const content = await page.textContent('.header');
  const checked = await page.isChecked('input#terms');
  const disabled = await page.isDisabled('button.submit');
  const editable = await page.isEditable('input.name');
  const enabled = await page.isEnabled('button.save');
  const hidden = await page.isHidden('.loading');
  const visible = await page.isVisible('.dashboard');
  expect(visible).toBe(true);
});

// PW-DEPREC-003: Deprecated wait methods
test('uses deprecated waitForNavigation', async ({ page }) => {
  await page.goto('/login');
  await page.locator('button.submit').click();
  await page.waitForNavigation();
  expect(page.url()).toContain('/dashboard');
});

test('uses deprecated waitForSelector', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForSelector('.loading-spinner', { state: 'hidden' });
  await page.waitForSelector('.content-loaded');
  expect(await page.locator('.content-loaded').isVisible()).toBe(true);
});

// PW-DEPREC-004: Deprecated test runner APIs
test.describe.parallel('parallel tests', () => {
  test('parallel test 1', async ({ page }) => {
    await page.goto('/page1');
    await expect(page.locator('h1')).toBeVisible();
  });
  test('parallel test 2', async ({ page }) => {
    await page.goto('/page2');
    await expect(page.locator('h1')).toBeVisible();
  });
});

test.describe.serial('serial tests', () => {
  test('step 1', async ({ page }) => {
    await page.goto('/wizard/step1');
    await expect(page.locator('h1')).toHaveText('Step 1');
  });
  test('step 2', async ({ page }) => {
    await page.goto('/wizard/step2');
    await expect(page.locator('h1')).toHaveText('Step 2');
  });
});

// PW-DEPREC-006: Deprecated BrowserContext methods
test('uses deprecated setHTTPCredentials', async ({ context, page }) => {
  await context.setHTTPCredentials({ username: 'user', password: 'pass' });
  await page.goto('/protected');
  await expect(page.locator('h1')).toHaveText('Protected Page');
});
