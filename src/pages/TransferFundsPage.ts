import { Locator, Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * ParaBank's Transfer Funds form (transfer.htm).
 *
 * Verified live (self-hosted instance) — ParaBank performs NO business-rule
 * validation on the amount: overdrafts, $0, negative amounts, and
 * same-account transfers are all accepted and produce "Transfer Complete!".
 * Only a non-numeric amount fails, and it fails hard (generic 500 error
 * panel from BasePage), not a graceful inline validation message.
 */
export class TransferFundsPage extends BasePage {
  private readonly amountInput: Locator;
  private readonly fromAccountSelect: Locator;
  private readonly toAccountSelect: Locator;
  private readonly transferButton: Locator;

  readonly resultHeading: Locator;
  readonly resultMessage: Locator;

  constructor(page: Page) {
    super(page);
    // #amount / #fromAccountId / #toAccountId have no name attribute or
    // accessible label — id is the only stable, verified handle.
    this.amountInput = page.locator('#amount');
    this.fromAccountSelect = page.locator('#fromAccountId');
    this.toAccountSelect = page.locator('#toAccountId');
    this.transferButton = page.getByRole('button', { name: 'Transfer' });

    this.resultHeading = page.getByRole('heading', { name: 'Transfer Complete!', level: 1 });
    this.resultMessage = this.page.locator('p').filter({ hasText: 'has been transferred from account' });
  }

  async goto(): Promise<void> {
    // No leading slash — see LoginPage.goto() for why.
    await this.page.goto('transfer.htm');
  }

  async transfer(amount: string, fromAccountId: string, toAccountId: string): Promise<void> {
    await this.amountInput.fill(amount);
    await this.fromAccountSelect.selectOption(fromAccountId);
    await this.toAccountSelect.selectOption(toAccountId);
    await this.transferButton.click();
  }
}
