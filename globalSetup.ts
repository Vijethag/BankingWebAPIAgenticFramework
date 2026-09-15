import type { FullConfig } from '@playwright/test';
import { request } from '@playwright/test';
import { ApiHelper } from './src/api/ApiHelper';
import { AccountClient, AccountType } from './src/api/AccountClient';
import { SEEDED_CUSTOMER_ID, TRANSFER_ACCOUNTS } from './src/fixtures/base';
import { writePool, ApiAccountsPoolEntry } from './src/setup/apiAccountsPool';

/**
 * Provisions one isolated (checking, savings) account pair per worker for
 * the standalone tests/api/ suite — see `apiAccounts` fixture in
 * src/fixtures/base.ts for how each worker consumes its pair.
 *
 * MUST run strictly sequentially. Verified live: `POST /createAccount` has
 * a real, reproducible concurrency bug in this ParaBank release — firing
 * just 4-5 concurrent calls (even against *different* source accounts, so
 * it isn't simple per-account balance contention) causes most of them to
 * fail with "Could not create new account...". This mirrors the same
 * broad-exception-swallowing pattern documented for customer registration
 * in specs/transfer-funds.md. globalSetup runs once, before any worker
 * starts issuing parallel requests, so building the whole pool here (one
 * account at a time, always awaited) sidesteps the bug entirely instead of
 * masking it with retries.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const poolSize = Math.max(config.workers || 1, 1);

  const apiContext = await request.newContext();
  try {
    const accountClient = new AccountClient(new ApiHelper(apiContext, process.env.API_BASE_URL!));
    const pool: ApiAccountsPoolEntry[] = [];

    for (let i = 0; i < poolSize; i++) {
      // Chain funding off the previous pair's savings account (never a UI
      // suite account) after the very first, one-time bootstrap debit.
      const fundingSource = i === 0 ? TRANSFER_ACCOUNTS.tf06NonNumeric.to : pool[i - 1]!.savingsAccountId;
      const checking = await accountClient.createAccount(SEEDED_CUSTOMER_ID, AccountType.CHECKING, fundingSource);
      const savings = await accountClient.createAccount(SEEDED_CUSTOMER_ID, AccountType.SAVINGS, checking.id);
      pool.push({ checkingAccountId: checking.id, savingsAccountId: savings.id });
    }

    writePool(pool);
  } finally {
    await apiContext.dispose();
  }
}
