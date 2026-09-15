import { Locator, Page } from '@playwright/test';

/**
 * Common ParaBank chrome shared by every logged-in page: the left-hand
 * "Account Services" nav and the app-wide generic error panel that ParaBank
 * renders (with an HTTP 500) whenever a server-side exception is thrown
 * (confirmed live: invalid login, non-numeric transfer amount, etc. all
 * render this same "Error!" panel).
 *
 * No expect() calls in here — assertions belong in tests only.
 */
export abstract class BasePage {
  protected readonly page: Page;

  protected readonly openNewAccountLink: Locator;
  protected readonly accountsOverviewLink: Locator;
  protected readonly transferFundsLink: Locator;
  protected readonly billPayLink: Locator;
  protected readonly findTransactionsLink: Locator;
  protected readonly updateContactInfoLink: Locator;
  protected readonly requestLoanLink: Locator;

  // Public (unlike the nav links above): its presence/absence is the stable,
  // reusable signal of an authenticated session — used directly in
  // assertions (e.g. login spec), not just for internal navigation.
  readonly logOutLink: Locator;

  readonly genericErrorHeading: Locator;
  readonly genericErrorMessage: Locator;

  constructor(page: Page) {
    this.page = page;

    this.openNewAccountLink = page.getByRole('link', { name: 'Open New Account' });
    this.accountsOverviewLink = page.getByRole('link', { name: 'Accounts Overview' });
    this.transferFundsLink = page.getByRole('link', { name: 'Transfer Funds' });
    this.billPayLink = page.getByRole('link', { name: 'Bill Pay' });
    this.findTransactionsLink = page.getByRole('link', { name: 'Find Transactions' });
    this.updateContactInfoLink = page.getByRole('link', { name: 'Update Contact Info' });
    this.requestLoanLink = page.getByRole('link', { name: 'Request Loan' });
    this.logOutLink = page.getByRole('link', { name: 'Log Out' });

    // Verified live: ParaBank's generic 500 error page always renders this
    // exact heading + message, regardless of the underlying server exception.
    this.genericErrorHeading = page.getByRole('heading', { name: 'Error!', level: 1 });
    this.genericErrorMessage = page.getByText('An internal error has occurred and has been logged.');
  }

  abstract goto(): Promise<void>;

  async isGenericErrorDisplayed(): Promise<boolean> {
    return this.genericErrorHeading.isVisible();
  }

  async goToTransferFunds(): Promise<void> {
    await this.transferFundsLink.click();
  }

  async goToAccountsOverview(): Promise<void> {
    await this.accountsOverviewLink.click();
  }

  async logOut(): Promise<void> {
    await this.logOutLink.click();
  }

  async getPageTitle(): Promise<string> {
    return this.page.title();
  }

  getCurrentUrl(): string {
    return this.page.url();
  }

  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('load');
  }
}
