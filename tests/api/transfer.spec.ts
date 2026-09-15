import { test, expect } from '../../src/fixtures/base';

/**
 * REST equivalent of the UI Transfer Funds flow (see specs/transfer-funds.md
 * for the deeply-verified UI-side business rules). Verified live: the
 * lenient money-movement rules are the same via REST (no overdraft/zero/
 * negative validation), but the *error-handling mechanics* for malformed
 * input differ noticeably from the UI's uniform 500 "Error!" panel:
 *   - non-numeric `amount` -> HTTP 404, empty body (JAX-RS param binding
 *     failure, before the resource method ever runs)
 *   - missing required `amount` -> HTTP 500 whose body is a full HTML page
 *     (the *UI's* generic error template, oddly reused for a REST endpoint)
 * Each of those is asserted explicitly below rather than worked around,
 * since the inconsistency itself is a real, useful finding.
 */
test.describe('API - POST /transfer', () => {
  test('moves the exact amount between two owned accounts', async ({ accountClient, apiAccounts }) => {
    const { checkingAccountId, savingsAccountId } = apiAccounts;
    const amount = 10;

    const fromBefore = await accountClient.getAccount(checkingAccountId);
    const toBefore = await accountClient.getAccount(savingsAccountId);

    const { status, body } = await accountClient.transfer(checkingAccountId, savingsAccountId, amount);

    expect(status).toBe(200);
    expect(body).toBe(`Successfully transferred $${amount} from account #${checkingAccountId} to account #${savingsAccountId}`);

    const fromAfter = await accountClient.getAccount(checkingAccountId);
    const toAfter = await accountClient.getAccount(savingsAccountId);
    expect(fromAfter.balance).toBeCloseTo(fromBefore.balance - amount, 2);
    expect(toAfter.balance).toBeCloseTo(toBefore.balance + amount, 2);
  });

  test('succeeds past the available balance — no overdraft protection, consistent with the UI', async ({
    accountClient,
    apiAccounts,
  }) => {
    const { checkingAccountId, savingsAccountId } = apiAccounts;
    const fromBefore = await accountClient.getAccount(checkingAccountId);
    const amount = fromBefore.balance + 5_000;

    const { status } = await accountClient.transfer(checkingAccountId, savingsAccountId, amount);
    expect(status).toBe(200);

    const fromAfter = await accountClient.getAccount(checkingAccountId);
    expect(fromAfter.balance).toBeCloseTo(fromBefore.balance - amount, 2);
    expect(fromAfter.balance).toBeLessThan(0);
  });

  test('rejects an unknown account id with HTTP 400 and a plain-text error', async ({ accountClient, apiAccounts }) => {
    const { status, body } = await accountClient.transfer(999_999, apiAccounts.savingsAccountId, 10);
    expect(status).toBe(400);
    expect(body).toBe(`Could not find account number 999999 and/or ${apiAccounts.savingsAccountId}`);
  });

  test('a non-numeric amount fails parameter binding with HTTP 404 (not the UI\'s 500 error panel)', async ({
    apiHelper,
    apiAccounts,
  }) => {
    const { status, body } = await apiHelper.post(
      `/transfer?fromAccountId=${apiAccounts.checkingAccountId}&toAccountId=${apiAccounts.savingsAccountId}&amount=abc`,
      {},
      { Accept: 'application/json' }
    );
    expect(status).toBe(404);
    expect(body).toBe('');
  });

  test('a missing required amount param fails with HTTP 500 and an HTML error body', async ({ apiHelper, apiAccounts }) => {
    const { status, body } = await apiHelper.post(
      `/transfer?fromAccountId=${apiAccounts.checkingAccountId}&toAccountId=${apiAccounts.savingsAccountId}`,
      {},
      { Accept: 'application/json' }
    );
    expect(status).toBe(500);
    expect(typeof body).toBe('string');
    expect(body as string).toContain('An internal error has occurred and has been logged.');
  });
});
