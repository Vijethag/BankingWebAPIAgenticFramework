import { test, expect } from '../../src/fixtures/base';

test.describe('API - POST /deposit', () => {
  test('increases the target account balance by the exact amount', async ({ accountClient, apiAccounts }) => {
    const { checkingAccountId } = apiAccounts;
    const amount = 25;
    const before = await accountClient.getAccount(checkingAccountId);

    const { status, body } = await accountClient.deposit(checkingAccountId, amount);

    expect(status).toBe(200);
    expect(body).toBe(`Successfully deposited $${amount} to account #${checkingAccountId}`);
    const after = await accountClient.getAccount(checkingAccountId);
    expect(after.balance).toBeCloseTo(before.balance + amount, 2);
  });

  test('rejects an unknown account id with HTTP 400', async ({ accountClient }) => {
    const { status, body } = await accountClient.deposit(999_999, 10);
    expect(status).toBe(400);
    expect(body).toBe('Could not find account number 999999');
  });
});

test.describe('API - POST /withdraw', () => {
  test('decreases the source account balance by the exact amount', async ({ accountClient, apiAccounts }) => {
    const { savingsAccountId } = apiAccounts;
    const amount = 15;
    const before = await accountClient.getAccount(savingsAccountId);

    const { status, body } = await accountClient.withdraw(savingsAccountId, amount);

    expect(status).toBe(200);
    expect(body).toBe(`Successfully withdrew $${amount} from account #${savingsAccountId}`);
    const after = await accountClient.getAccount(savingsAccountId);
    expect(after.balance).toBeCloseTo(before.balance - amount, 2);
  });

  test('succeeds past the available balance — no overdraft protection, consistent with transfer()', async ({
    accountClient,
    apiAccounts,
  }) => {
    const { savingsAccountId } = apiAccounts;
    const before = await accountClient.getAccount(savingsAccountId);
    const amount = before.balance + 10_000;

    const { status } = await accountClient.withdraw(savingsAccountId, amount);
    expect(status).toBe(200);

    const after = await accountClient.getAccount(savingsAccountId);
    expect(after.balance).toBeCloseTo(before.balance - amount, 2);
    expect(after.balance).toBeLessThan(0);
  });

  test('rejects an unknown account id with HTTP 400', async ({ accountClient }) => {
    const { status, body } = await accountClient.withdraw(999_999, 10);
    expect(status).toBe(400);
    expect(body).toBe('Could not find account number 999999');
  });
});
