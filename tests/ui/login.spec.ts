import { test, expect, SEEDED_USER } from '../../src/fixtures/base';

/**
 * Implements specs/parabank-login.md (Planner output) 1:1 — scenarios 1.1
 * through 1.5. Do not change assertions here without updating that spec
 * first; this file is intentionally traceable back to it scenario-by-scenario.
 *
 * Each test starts its own unauthenticated `loginPage.goto()` (a fresh
 * browser context per Playwright test, so no explicit logout-before-test is
 * needed for the negative scenarios) and does not depend on any other test.
 */
test.describe('ParaBank Login', () => {
  test('1.1 Valid registered user can login', async ({ page, loginPage, accountsOverviewPage }) => {
    await loginPage.goto();
    await loginPage.login(SEEDED_USER.username, SEEDED_USER.password);

    // Server appends ";jsessionid=..." on the first navigation of a fresh,
    // cookie-less context (verified live), so the URL check can't anchor `$`
    // right after ".htm" — allow that optional suffix.
    await expect(page).toHaveURL(/\/overview\.htm(;|$)/);
    await expect(page).toHaveTitle('ParaBank | Accounts Overview');
    await expect(accountsOverviewPage.heading).toBeVisible();
    await expect(accountsOverviewPage.welcomeMessage('John Smith')).toBeVisible();

    // Presence of "Log Out" is the stable authenticated-session signal —
    // it doesn't exist anywhere on the logged-out login page.
    await expect(accountsOverviewPage.logOutLink).toBeVisible();

    await expect(accountsOverviewPage.accountsTable).toBeVisible();
    await expect(
      accountsOverviewPage.accountsTable.getByRole('columnheader', { name: 'Account' })
    ).toBeVisible();
    await expect(
      accountsOverviewPage.accountsTable.getByRole('columnheader', { name: 'Balance*' })
    ).toBeVisible();
    await expect(
      accountsOverviewPage.accountsTable.getByRole('columnheader', { name: 'Available Amount' })
    ).toBeVisible();
    await expect(accountsOverviewPage.accountsTable.getByRole('row')).not.toHaveCount(0);

    // Cleanup per Planner: log out to end the authenticated session.
    await accountsOverviewPage.logOut();
    await expect(page).toHaveURL(/index\.htm/);
  });

  test('1.2 Empty username shows validation error', async ({ page, loginPage, accountsOverviewPage }) => {
    await loginPage.goto();
    await loginPage.login('', SEEDED_USER.password);

    // See the ";jsessionid=..." note in scenario 1.1 above.
    await expect(page).toHaveURL(/\/login\.htm(;|$)/);
    await expect(page).toHaveTitle('ParaBank | Error');
    await expect(loginPage.genericErrorHeading).toBeVisible();
    await expect(loginPage.missingCredentialsError).toBeVisible();

    // Neither submitted value is retained after the failed submission.
    await expect(loginPage.usernameInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');

    // Remains unauthenticated: back on the Customer Login form, no
    // Accounts Overview content or "Log Out" link anywhere on the page.
    await expect(loginPage.customerLoginHeading).toBeVisible();
    await expect(accountsOverviewPage.heading).not.toBeVisible();
    await expect(accountsOverviewPage.logOutLink).not.toBeVisible();
  });

  test('1.3 Empty password shows validation error', async ({ page, loginPage, accountsOverviewPage }) => {
    await loginPage.goto();
    await loginPage.login(SEEDED_USER.username, '');

    await expect(page).toHaveURL(/\/login\.htm(;|$)/);
    await expect(page).toHaveTitle('ParaBank | Error');
    await expect(loginPage.genericErrorHeading).toBeVisible();
    // Identical wording to 1.2 — ParaBank does not distinguish which field was missing.
    await expect(loginPage.missingCredentialsError).toBeVisible();

    await expect(loginPage.usernameInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');

    await expect(loginPage.customerLoginHeading).toBeVisible();
    await expect(accountsOverviewPage.heading).not.toBeVisible();
    await expect(accountsOverviewPage.logOutLink).not.toBeVisible();
  });

  test('1.4 Empty username and password shows validation error', async ({
    page,
    loginPage,
    accountsOverviewPage,
  }) => {
    await loginPage.goto();
    await loginPage.login('', '');

    await expect(page).toHaveURL(/\/login\.htm(;|$)/);
    await expect(page).toHaveTitle('ParaBank | Error');
    await expect(loginPage.genericErrorHeading).toBeVisible();
    // Identical wording to 1.2 and 1.3.
    await expect(loginPage.missingCredentialsError).toBeVisible();

    await expect(loginPage.usernameInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');

    await expect(loginPage.customerLoginHeading).toBeVisible();
    await expect(accountsOverviewPage.heading).not.toBeVisible();
    await expect(accountsOverviewPage.logOutLink).not.toBeVisible();
  });

  test('1.5 Invalid credentials show authentication error', async ({
    page,
    loginPage,
    accountsOverviewPage,
  }) => {
    await loginPage.goto();
    await loginPage.login('foo', 'bar');

    await expect(page).toHaveURL(/\/login\.htm(;|$)/);
    await expect(page).toHaveTitle('ParaBank | Error');
    await expect(loginPage.genericErrorHeading).toBeVisible();
    // Distinct wording from the empty-field scenarios (1.2-1.4): the app
    // differentiates "missing input" from "credentials don't match an account".
    await expect(loginPage.invalidCredentialsError).toBeVisible();

    await expect(loginPage.usernameInput).toHaveValue('');
    await expect(loginPage.passwordInput).toHaveValue('');

    // Never reaches overview.htm — remains unauthenticated.
    await expect(page).not.toHaveURL(/\/overview\.htm(;|$)/);
    await expect(loginPage.customerLoginHeading).toBeVisible();
    await expect(accountsOverviewPage.heading).not.toBeVisible();
    await expect(accountsOverviewPage.logOutLink).not.toBeVisible();
  });
});
