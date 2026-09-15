import { test, expect, SEEDED_USER, TRANSFER_ACCOUNTS } from '../../../src/fixtures/base';
import { formatParaBankAmount } from '../../../src/utils/formatCurrency';

test.describe('Transfer Funds - TF-05 Negative-amount transfer', () => {
  test('is allowed and reverses the effective direction of the balance movement', async ({
    loginPage,
    transferFundsPage,
    accountClient,
  }) => {
    const { from: fromAccountId, to: toAccountId } = TRANSFER_ACCOUNTS.tf05NegativeAmount;
    const amount = -20;

    const fromBefore = await accountClient.getAccount(fromAccountId);
    const toBefore = await accountClient.getAccount(toAccountId);

    await loginPage.goto();
    await loginPage.login(SEEDED_USER.username, SEEDED_USER.password);
    await transferFundsPage.goto();
    await transferFundsPage.transfer(String(amount), String(fromAccountId), String(toAccountId));

    await expect(transferFundsPage.resultHeading).toBeVisible();
    await expect(transferFundsPage.resultMessage).toHaveText(
      `${formatParaBankAmount(amount)} has been transferred from account #${fromAccountId} to account #${toAccountId}.`
    );

    // Verified live ledger semantics: from.balance -= amount, to.balance += amount.
    // With a negative amount this means the "from" account actually gains money
    // and the "to" account actually loses money.
    const fromAfter = await accountClient.getAccount(fromAccountId);
    const toAfter = await accountClient.getAccount(toAccountId);
    expect(fromAfter.balance).toBeCloseTo(fromBefore.balance - amount, 2);
    expect(toAfter.balance).toBeCloseTo(toBefore.balance + amount, 2);
    expect(fromAfter.balance).toBeGreaterThan(fromBefore.balance);
    expect(toAfter.balance).toBeLessThan(toBefore.balance);
  });
});
