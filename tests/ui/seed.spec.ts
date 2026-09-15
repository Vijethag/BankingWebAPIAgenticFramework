import { test } from '@playwright/test';

// Seed — lands on the ParaBank home page (baseURL comes from ui-chromium project config).
// Scenario specs assume a fresh start *after* this seed. Used as the attach point for
// playwright-cli exploration during planning/generation/healing.
test('seed', async ({ page }) => {
  // No leading slash: baseURL has a path segment ("/parabank/"), and a
  // leading-slash relative URL resolves from the host root, dropping it.
  await page.goto('');
});
