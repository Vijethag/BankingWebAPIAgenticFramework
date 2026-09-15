import { test, expect } from '../../src/fixtures/base';
import { UserFactory } from '../../src/utils/UserFactory';

/**
 * Flow: Generate User -> Open Registration -> Fill Form -> Submit -> Verify
 * Account Created.
 *
 * Marked test.fail(): live exploration confirmed a reproducible ParaBank
 * bug — register.htm rejects every submission with "This username already
 * exists.", even with a guaranteed-unique, timestamp+random username on a
 * fresh container (see specs/transfer-funds.md, "Setup — known-app-bug
 * detour", for the full repro incl. root cause in RegisterCustomerController
 * / JdbcSequenceDao). Re-verified live immediately before adding this test:
 * 6/6 real-browser attempts failed identically.
 *
 * test.fail() keeps this failure "expected" (won't break CI) while still
 * running the real flow every time. If ParaBank's registration is ever
 * fixed, this test will start unexpectedly *passing*, which Playwright
 * flags as a failure — surfacing the fix so this annotation can be removed
 * and the bug workaround (SEEDED_USER in src/fixtures/base.ts) revisited.
 */
test('customer can register', async ({ page, registerPage }) => {
  test.fail(true, 'Known ParaBank bug: register.htm rejects every submission — see specs/transfer-funds.md');

  const user = UserFactory.create();

  await registerPage.goto();
  await registerPage.register(user);

  await expect(page.getByRole('heading', { level: 1, name: `Welcome ${user.username}` })).toBeVisible();
});
