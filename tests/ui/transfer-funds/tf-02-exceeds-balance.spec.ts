import { test, expect, SEEDED_USER, TRANSFER_ACCOUNTS } from '../../../src/fixtures/base';
import { formatParaBankAmount } from '../../../src/utils/formatCurrency';

test.describe('Transfer Funds - TF-02 Amount exceeds available balance', () => {
  test('succeeds anyway and drives the source account negative (no overdraft protection)', async ({
    loginPage,
    transferFundsPage,
    accountClient,
  }) => {
    const { from: fromAccountId, to: toAccountId } = TRANSFER_ACCOUNTS.tf02ExceedsBalance;

    const fromBefore = await accountClient.getAccount(fromAccountId);
    // Verified live: ParaBank enforces no minimum-balance / overdraft rule on
    // Transfer Funds, so an amount far beyond the available balance is
    // accepted the same as any other.
    const amount = fromBefore.balance + 10_000;

    await loginPage.goto();
    await loginPage.login(SEEDED_USER.username, SEEDED_USER.password);
    await transferFundsPage.goto();
    await transferFundsPage.transfer(String(amount), String(fromAccountId), String(toAccountId));

    await expect(transferFundsPage.resultHeading).toBeVisible();
    await expect(transferFundsPage.resultMessage).toHaveText(
      `${formatParaBankAmount(amount)} has been transferred from account #${fromAccountId} to account #${toAccountId}.`
    );

    const fromAfter = await accountClient.getAccount(fromAccountId);
    expect(fromAfter.balance).toBeCloseTo(fromBefore.balance - amount, 2);
    expect(fromAfter.balance).toBeLessThan(0);
  });
});
