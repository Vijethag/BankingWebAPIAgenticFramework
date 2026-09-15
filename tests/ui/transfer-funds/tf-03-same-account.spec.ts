import { test, expect, SEEDED_USER, TRANSFER_ACCOUNTS } from '../../../src/fixtures/base';
import { formatParaBankAmount } from '../../../src/utils/formatCurrency';

test.describe('Transfer Funds - TF-03 Same-account transfer', () => {
  test('is allowed and nets to a zero balance change with a matching Debit/Credit pair', async ({
    loginPage,
    transferFundsPage,
    accountClient,
  }) => {
    const { account: accountId } = TRANSFER_ACCOUNTS.tf03SameAccount;
    const amount = 15;

    const before = await accountClient.getAccount(accountId);

    await loginPage.goto();
    await loginPage.login(SEEDED_USER.username, SEEDED_USER.password);
    await transferFundsPage.goto();
    await transferFundsPage.transfer(String(amount), String(accountId), String(accountId));

    await expect(transferFundsPage.resultHeading).toBeVisible();
    await expect(transferFundsPage.resultMessage).toHaveText(
      `${formatParaBankAmount(amount)} has been transferred from account #${accountId} to account #${accountId}.`
    );

    const after = await accountClient.getAccount(accountId);
    expect(after.balance).toBeCloseTo(before.balance, 2);

    const transactions = await accountClient.getTransactions(accountId);
    const [debit, credit] = transactions.slice(-2);
    expect(debit).toMatchObject({ type: 'Debit', amount, description: 'Funds Transfer Sent' });
    expect(credit).toMatchObject({ type: 'Credit', amount, description: 'Funds Transfer Received' });
  });
});
