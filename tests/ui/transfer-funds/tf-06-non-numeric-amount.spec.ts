import { test, expect, SEEDED_USER, TRANSFER_ACCOUNTS } from '../../../src/fixtures/base';

test.describe('Transfer Funds - TF-06 Non-numeric amount', () => {
  test('fails hard with the generic server error panel, not an inline validation message', async ({
    loginPage,
    transferFundsPage,
    accountClient,
  }) => {
    const { from: fromAccountId, to: toAccountId } = TRANSFER_ACCOUNTS.tf06NonNumeric;

    const fromBefore = await accountClient.getAccount(fromAccountId);
    const toBefore = await accountClient.getAccount(toAccountId);

    await loginPage.goto();
    await loginPage.login(SEEDED_USER.username, SEEDED_USER.password);
    await transferFundsPage.goto();
    await transferFundsPage.transfer('abc', String(fromAccountId), String(toAccountId));

    // Verified live: a non-numeric amount throws server-side (NumberFormatException)
    // and renders ParaBank's app-wide generic error panel, not a friendly field error.
    await expect(transferFundsPage.genericErrorHeading).toBeVisible();
    await expect(transferFundsPage.genericErrorMessage).toBeVisible();
    await expect(transferFundsPage.resultHeading).not.toBeVisible();

    const fromAfter = await accountClient.getAccount(fromAccountId);
    const toAfter = await accountClient.getAccount(toAccountId);
    expect(fromAfter.balance).toBeCloseTo(fromBefore.balance, 2);
    expect(toAfter.balance).toBeCloseTo(toBefore.balance, 2);
  });
});
