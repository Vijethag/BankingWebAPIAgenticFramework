import * as fs from 'fs';
import { test as baseTest, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { TransferFundsPage } from '../pages/TransferFundsPage';
import { AccountsOverviewPage } from '../pages/AccountsOverviewPage';
import { ApiHelper } from '../api/ApiHelper';
import { AccountClient } from '../api/AccountClient';
import { readPool, ApiAccountsPoolEntry } from '../setup/apiAccountsPool';

/**
 * ParaBank ships every fresh database with this customer pre-seeded
 * (id 12212, "John Smith") — verified live on the self-hosted instance.
 *
 * We rely on this seeded user rather than dynamically registering a fresh
 * one per test/worker: live exploration confirmed `register.htm` has a
 * genuine, reproducible server-side bug in the current parasoft/parabank
 * release — it reports "This username already exists" for every
 * submission, including cryptographically-random usernames on a
 * just-recreated, never-before-used container. See specs/transfer-funds.md
 * for the full repro. Filed as a known app defect, not an environment issue.
 */
export const SEEDED_USER = { username: 'john', password: 'demo' };
export const SEEDED_CUSTOMER_ID = 12212;

/**
 * Fixed, non-overlapping pairs of the seeded user's 11 pre-existing
 * accounts, one dedicated pair per Transfer Funds scenario. Because no two
 * scenarios ever touch the same account, they stay safe to run fully in
 * parallel (`fullyParallel: true`) despite sharing one seeded customer —
 * there is no dynamic account-provisioning alternative available (see
 * SEEDED_USER above).
 */
export const TRANSFER_ACCOUNTS = {
  tf01HappyPath: { from: 12345, to: 12456 },
  tf02ExceedsBalance: { from: 12567, to: 12678 },
  tf03SameAccount: { account: 12789 },
  tf04ZeroAmount: { from: 12900, to: 13011 },
  tf05NegativeAmount: { from: 13122, to: 13233 },
  tf06NonNumeric: { from: 13344, to: 54321 },
} as const;

/**
 * Isolated pair of accounts for the standalone tests/api/ suite — one pair
 * per worker, pre-provisioned *sequentially* by globalSetup.ts (see that
 * file for why: live testing found a real ParaBank concurrency bug in
 * `POST /createAccount` that makes most concurrent calls fail outright).
 * This fixture just reads its worker's slot out of the pool globalSetup
 * already wrote to disk — no network calls, no race.
 */
export type ApiTestAccounts = ApiAccountsPoolEntry;

type TestFixtures = {
  loginPage: LoginPage;
  registerPage: RegisterPage;
  transferFundsPage: TransferFundsPage;
  accountsOverviewPage: AccountsOverviewPage;
  apiHelper: ApiHelper;
  accountClient: AccountClient;
};

type WorkerFixtures = {
  apiAccounts: ApiTestAccounts;
};

/**
 * Single source of truth for fixtures. Always `import { test, expect } from
 * '../../src/fixtures/base'` in specs — never import `test` directly from
 * `@playwright/test`.
 */
export const test = baseTest.extend<TestFixtures, WorkerFixtures>({
  /**
   * Overrides (not adds to) Playwright's built-in `page` fixture to attach
   * the full page DOM (`page.content()`) as evidence whenever a test
   * doesn't pass — on top of the screenshot/trace/error-context.md
   * Playwright already produces. This is deliberately scoped by
   * *overriding* `page` rather than declaring a new `auto: true` fixture:
   * fixtures are lazy, so this only ever runs for tests that actually use
   * `page` (i.e. UI specs, transitively via loginPage/registerPage/etc.) —
   * tests/api specs use the `request` fixture instead and never trigger it,
   * so there's no added browser/overhead cost there.
   *
   * Why this evidence is needed: the aria snapshot in error-context.md
   * (used by FailureAnalyzer) doesn't expose raw HTML attributes, so it
   * can't tell a Healer *what the correct `name`/`id`/etc. attribute value
   * actually is* on a locator-drift failure. The raw DOM captured here is
   * what src/agents/healer/proposeLocatorFix.ts sends an LLM to propose a
   * concrete replacement locator.
   *
   * Attached via `path` (a real file under the test's output dir), not
   * `body` — src/agents/healer/buildFailureInput.ts's findAttachmentPath()
   * only ever reads an attachment's `.path`. Playwright's JSON reporter
   * embeds `body`-based attachments inline (base64) instead of writing them
   * to disk, so a `body` attachment here would leave `fullDomPath` undefined
   * for every failure and silently disable the Healer entirely (verified
   * live — see the CI run this comment was added in response to).
   */
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
      try {
        const html = await page.content();
        const domPath = testInfo.outputPath('full-dom.html');
        fs.writeFileSync(domPath, html, 'utf-8');
        await testInfo.attach('full-dom', { path: domPath, contentType: 'text/html' });
      } catch {
        // Best-effort only — the page may already be closed/navigated away
        // after certain hard failures (e.g. a crashed browser context).
      }
    }
  },

  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },

  transferFundsPage: async ({ page }, use) => {
    await use(new TransferFundsPage(page));
  },

  accountsOverviewPage: async ({ page }, use) => {
    await use(new AccountsOverviewPage(page));
  },

  apiHelper: async ({ request }, use) => {
    await use(new ApiHelper(request, process.env.API_BASE_URL!));
  },

  accountClient: async ({ apiHelper }, use) => {
    await use(new AccountClient(apiHelper));
  },

  apiAccounts: [
    async ({}, use, workerInfo) => {
      const pool = readPool();
      const accounts = pool[workerInfo.workerIndex % pool.length];
      if (!accounts) {
        throw new Error('api-accounts-pool.json is empty — did globalSetup.ts run?');
      }
      await use(accounts);
    },
    { scope: 'worker' },
  ],
});

export { expect } from '@playwright/test';
