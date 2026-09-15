import { test, expect, SEEDED_CUSTOMER_ID, TRANSFER_ACCOUNTS } from '../../src/fixtures/base';
import { AccountType } from '../../src/api/AccountClient';

test.describe('API - GET /accounts/{accountId}', () => {
  test('valid id returns the account', async ({ accountClient }) => {
    const { account } = TRANSFER_ACCOUNTS.tf03SameAccount;
    const result = await accountClient.getAccount(account);
    expect(result).toMatchObject({ id: account, customerId: SEEDED_CUSTOMER_ID });
    expect(['CHECKING', 'SAVINGS', 'LOAN']).toContain(result.type);
  });

  test('unknown id returns HTTP 400 with a plain-text error', async ({ accountClient }) => {
    const { status, body } = await accountClient.getAccountRaw(999_999);
    expect(status).toBe(400);
    expect(body).toBe('Could not find account #999999');
  });
});

test.describe('API - GET /customers/{customerId}/accounts', () => {
  test("returns every account owned by the seeded customer", async ({ accountClient }) => {
    const accounts = await accountClient.getAccountsForCustomer(SEEDED_CUSTOMER_ID);
    expect(accounts.length).toBeGreaterThanOrEqual(11);
    for (const account of accounts) {
      expect(account.customerId).toBe(SEEDED_CUSTOMER_ID);
    }
    // Every fixed pair the UI suite depends on must actually exist.
    const ids = accounts.map((a) => a.id);
    for (const pair of Object.values(TRANSFER_ACCOUNTS)) {
      const expectedIds = 'account' in pair ? [pair.account] : [pair.from, pair.to];
      for (const id of expectedIds) {
        expect(ids).toContain(id);
      }
    }
  });
});

test.describe('API - POST /createAccount', () => {
  test('creates a new account funded with exactly $100 debited from the source account', async ({
    accountClient,
    apiAccounts,
  }) => {
    // Chains off the fixture's own isolated savings account (never touched
    // by the UI suite), so this stays independent of the other tests here.
    const sourceBefore = await accountClient.getAccount(apiAccounts.savingsAccountId);

    const newAccount = await accountClient.createAccount(SEEDED_CUSTOMER_ID, AccountType.CHECKING, apiAccounts.savingsAccountId);

    expect(newAccount).toMatchObject({ customerId: SEEDED_CUSTOMER_ID, type: 'CHECKING' });
    const newAccountAfter = await accountClient.getAccount(newAccount.id);
    expect(newAccountAfter.balance).toBeCloseTo(100, 2);

    const sourceAfter = await accountClient.getAccount(apiAccounts.savingsAccountId);
    expect(sourceAfter.balance).toBeCloseTo(sourceBefore.balance - 100, 2);
  });

  test('rejects an unknown fromAccountId with HTTP 400', async ({ apiHelper }) => {
    const { status, body } = await apiHelper.post(
      `/createAccount?customerId=${SEEDED_CUSTOMER_ID}&newAccountType=${AccountType.CHECKING}&fromAccountId=999999`,
      {},
      { Accept: 'application/json' }
    );
    expect(status).toBe(400);
    expect(body).toBe(`Could not create new account for customer ${SEEDED_CUSTOMER_ID} from account 999999`);
  });
});
