import { test, expect } from '@playwright/test';

test.describe('DroneMedic Smoke Tests', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/DroneMedic/i);
  });

  test('public status page loads without auth', async ({ page }) => {
    await page.goto('/status');
    await expect(page.locator('text=DroneMedic Operations')).toBeVisible({ timeout: 10000 });
  });

  test('login page renders', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('demo mode bypass works', async ({ page }) => {
    await page.goto('/login');
    // Look for demo/skip button
    const skipButton = page.locator('text=/skip|demo/i');
    if (await skipButton.isVisible()) {
      await skipButton.click();
      await expect(page).toHaveURL(/dashboard/);
    }
  });

  test('deploy page loads in demo mode', async ({ page }) => {
    // Set demo mode in sessionStorage
    await page.goto('/login');
    await page.evaluate(() => sessionStorage.setItem('demo-mode', 'true'));
    await page.goto('/deploy');
    // Should see the chat/prompt interface
    await expect(page.locator('textarea, [contenteditable]').first()).toBeVisible({ timeout: 10000 });
  });
});
