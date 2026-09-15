import { test, expect, SEEDED_USER, TRANSFER_ACCOUNTS } from '../../../src/fixtures/base';

test.describe('Transfer Funds - TF-04 Zero-amount transfer', () => {
  test('is allowed and produces no functional balance change', async ({
    loginPage,
    transferFundsPage,
    accountClient,
  }) => {
    const { from: fromAccountId, to: toAccountId } = TRANSFER_ACCOUNTS.tf04ZeroAmount;

    const fromBefore = await accountClient.getAccount(fromAccountId);
    const toBefore = await accountClient.getAccount(toAccountId);

    await loginPage.goto();
    await loginPage.login(SEEDED_USER.username, SEEDED_USER.password);
    await transferFundsPage.goto();
    await transferFundsPage.transfer('0', String(fromAccountId), String(toAccountId));

    await expect(transferFundsPage.resultHeading).toBeVisible();
    await expect(transferFundsPage.resultMessage).toHaveText(
      `$0.00 has been transferred from account #${fromAccountId} to account #${toAccountId}.`
    );

    const fromAfter = await accountClient.getAccount(fromAccountId);
    const toAfter = await accountClient.getAccount(toAccountId);
    expect(fromAfter.balance).toBeCloseTo(fromBefore.balance, 2);
    expect(toAfter.balance).toBeCloseTo(toBefore.balance, 2);
  });
});
