import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * ParaBank's Accounts Overview page (overview.htm) — the landing page after
 * a successful login.
 *
 * Verified live (self-hosted instance): the accounts list is a semantic
 * `<table role="table">` with columnheaders "Account" / "Balance*" /
 * "Available Amount", one row per account the customer owns, plus a
 * trailing "Total" row. The "Welcome <Full Name>" text is a `<p>`, not a
 * heading — do not confuse it with the page's actual `<h1>Accounts
 * Overview</h1>`.
 */
export class AccountsOverviewPage extends BasePage {
  readonly heading: Locator;
  readonly accountsTable: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Accounts Overview', level: 1 });
    this.accountsTable = page.getByRole('table');
  }

  async goto(): Promise<void> {
    // No leading slash — see LoginPage.goto() for why.
    await this.page.goto('overview.htm');
  }

  /** "Welcome <Full Name>" paragraph rendered in the left nav on every logged-in page. */
  welcomeMessage(fullName: string): Locator {
    return this.page.getByText(`Welcome ${fullName}`, { exact: true });
  }
}
