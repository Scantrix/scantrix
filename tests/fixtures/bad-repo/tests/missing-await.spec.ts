import { test, expect } from "@playwright/test";

test("unawaited expect matchers", async ({ page }) => {
  await page.goto("/home");
  // BAD: missing await — should trigger PW-FLAKE-008
  expect(page.locator(".title")).toBeVisible();
  expect(page.locator(".content")).toHaveText("Hello");
  expect(page).toHaveTitle("Home");
});

test("unawaited test.step", async ({ page }) => {
  await page.goto("/home");
  // BAD: missing await on test.step
  test.step("verify header", async () => {
    await expect(page.locator("h1")).toBeVisible();
  });
});

test("properly awaited — no finding", async ({ page }) => {
  await page.goto("/home");
  // GOOD: all awaited
  await expect(page.locator(".title")).toBeVisible();
  await expect(page.locator(".content")).toHaveText("Hello");
  await test.step("verify header", async () => {
    await expect(page.locator("h1")).toBeVisible();
  });
});

test("unawaited soft assertion", async ({ page }) => {
  await page.goto("/home");
  // BAD: missing await on soft assertion
  expect.soft(page.locator(".title")).toBeVisible();
});

test("unawaited expect.poll", async ({ page }) => {
  // BAD: missing await on expect.poll
  expect.poll(() => page.locator(".count").textContent()).toBe("5");
});
