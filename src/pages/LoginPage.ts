import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * ParaBank's Customer Login form (rendered on index.htm).
 *
 * Locator note: the username/password <input> elements have no accessible
 * name, <label for>, placeholder, or data-testid (verified live via
 * outerHTML: `<input type="text" class="input" name="username">`) — the
 * visible "Username"/"Password" text is a sibling <p>, not an associated
 * label. Per the locator priority order, role/label/placeholder/testid all
 * fail here, so falling back to the `name` attribute is the documented,
 * justified exception rather than a default choice.
 */
export class LoginPage extends BasePage {
  // Public (unlike loginButton below): tests assert against these directly
  // (e.g. `toHaveValue('')` after a failed submission — see
  // specs/parabank-login.md 1.2-1.5), not just fill through login().
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  private readonly loginButton: Locator;

  readonly customerLoginHeading: Locator;

  // Verified live: empty-username and empty-password submissions render this
  // identical message — ParaBank does not distinguish which field was
  // missing. Note the heading itself ("Error!", level 1) is the same one
  // ParaBank's generic 500 panel uses, so we reuse BasePage.genericErrorHeading
  // rather than redeclaring it here.
  readonly missingCredentialsError: Locator;

  // Verified live: well-formed but wrong credentials render this distinct
  // message instead — a different string from missingCredentialsError above.
  readonly invalidCredentialsError: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.locator('input[name="user name"]');
    this.passwordInput = page.locator('input[name="password"]');
    this.loginButton = page.getByRole('button', { name: 'Log In' });

    this.customerLoginHeading = page.getByRole('heading', { name: 'Customer Login', level: 2 });
    this.missingCredentialsError = page.getByText('Please enter a username and password.');
    this.invalidCredentialsError = page.getByText('The username and password could not be verified.');
  }

  async goto(): Promise<void> {
    // No leading slash: baseURL has a path (".../parabank/"), and a
    // leading-slash relative URL resolves from the host root, dropping it
    // (verified: new URL('/index.htm', baseURL) strips "/parabank").
    await this.page.goto('index.htm');
  }

  /**
   * Submits the login form. Outcome varies (Accounts Overview on success,
   * the generic error panel on failure), so this intentionally returns void
   * rather than a next-page object — assert on the resulting state in the
   * test itself.
   */
  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
