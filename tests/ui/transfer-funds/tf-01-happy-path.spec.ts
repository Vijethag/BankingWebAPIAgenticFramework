import { test, expect, SEEDED_USER, TRANSFER_ACCOUNTS } from '../../../src/fixtures/base';
import { formatParaBankAmount } from '../../../src/utils/formatCurrency';

test.describe('Transfer Funds - TF-01 Happy path', () => {
  test('transferring between two owned accounts moves the exact amount and records matching transactions', async ({
    loginPage,
    transferFundsPage,
    accountClient,
  }) => {
    const { from: fromAccountId, to: toAccountId } = TRANSFER_ACCOUNTS.tf01HappyPath;
    const amount = 25;

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

    const fromAfter = await accountClient.getAccount(fromAccountId);
    const toAfter = await accountClient.getAccount(toAccountId);
    expect(fromAfter.balance).toBeCloseTo(fromBefore.balance - amount, 2);
    expect(toAfter.balance).toBeCloseTo(toBefore.balance + amount, 2);

    const fromTx = await accountClient.getTransactions(fromAccountId);
    const toTx = await accountClient.getTransactions(toAccountId);
    expect(fromTx[fromTx.length - 1]).toMatchObject({ type: 'Debit', amount, description: 'Funds Transfer Sent' });
    expect(toTx[toTx.length - 1]).toMatchObject({ type: 'Credit', amount, description: 'Funds Transfer Received' });
  });
});
