import { test, expect } from "@playwright/test";

test("app loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toBeVisible();
});

test("login works", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#username", "admin");
  await page.fill("#password", "password");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL("/dashboard");
});
