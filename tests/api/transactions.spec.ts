import { test, expect } from '../../src/fixtures/base';

test.describe('API - GET /accounts/{accountId}/transactions', () => {
  test('a deposit is recorded as a Credit transaction for the exact amount', async ({ accountClient, apiAccounts }) => {
    const { checkingAccountId } = apiAccounts;
    const amount = 42;

    const before = await accountClient.getTransactions(checkingAccountId);
    const { status } = await accountClient.deposit(checkingAccountId, amount);
    expect(status).toBe(200);
    const after = await accountClient.getTransactions(checkingAccountId);

    expect(after.length).toBe(before.length + 1);
    const newTx = after[after.length - 1];
    expect(newTx).toMatchObject({ accountId: checkingAccountId, type: 'Credit', amount });
  });

  test('a transfer is recorded as a Debit on the source and a Credit on the destination', async ({
    accountClient,
    apiAccounts,
  }) => {
    const { checkingAccountId, savingsAccountId } = apiAccounts;
    const amount = 7;

    const fromBefore = await accountClient.getTransactions(checkingAccountId);
    const toBefore = await accountClient.getTransactions(savingsAccountId);
    const { status } = await accountClient.transfer(checkingAccountId, savingsAccountId, amount);
    expect(status).toBe(200);
    const fromAfter = await accountClient.getTransactions(checkingAccountId);
    const toAfter = await accountClient.getTransactions(savingsAccountId);

    expect(fromAfter.length).toBe(fromBefore.length + 1);
    expect(toAfter.length).toBe(toBefore.length + 1);
    expect(fromAfter[fromAfter.length - 1]).toMatchObject({ accountId: checkingAccountId, type: 'Debit', amount });
    expect(toAfter[toAfter.length - 1]).toMatchObject({ accountId: savingsAccountId, type: 'Credit', amount });
  });

  test('an unknown account id returns HTTP 400 with a plain-text error', async ({ apiHelper }) => {
    const { status, body } = await apiHelper.get('/accounts/999999/transactions', { Accept: 'application/json' });
    expect(status).toBe(400);
    expect(body).toBe('Could not find transactions for account #999999');
  });
});
