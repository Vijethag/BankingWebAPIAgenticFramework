import { ApiHelper, ApiResult } from './ApiHelper';

export interface Customer {
  id: number;
  firstName: string;
  lastName: string;
  address: { street: string; city: string; state: string; zipCode: string };
  phoneNumber: string;
  ssn: string;
}

export interface Account {
  id: number;
  customerId: number;
  type: 'CHECKING' | 'SAVINGS' | 'LOAN';
  balance: number;
}

export interface Transaction {
  id: number;
  accountId: number;
  type: 'Credit' | 'Debit';
  date: number;
  amount: number;
  description: string;
}

/** Numeric codes for POST /createAccount's `newAccountType` param — verified live (0 = CHECKING, 1 = SAVINGS). */
export const AccountType = {
  CHECKING: 0,
  SAVINGS: 1,
} as const;

const JSON_HEADERS = { Accept: 'application/json' };

/**
 * Thin, ParaBank-specific wrapper around the generic ApiHelper.
 *
 * ParaBank's REST API defaults to XML (verified live: no Accept header ->
 * XML body) despite advertising JSON support, so every call here explicitly
 * requests `Accept: application/json`.
 */
export class AccountClient {
  private readonly api: ApiHelper;

  constructor(api: ApiHelper) {
    this.api = api;
  }

  async login(username: string, password: string): Promise<Customer> {
    const { body } = await this.api.get(`/login/${username}/${password}`, JSON_HEADERS);
    return body as Customer;
  }

  /** Raw variant of login() — for asserting status/body on invalid-credential paths (verified live: HTTP 400, plain-text body). */
  async loginRaw(username: string, password: string): Promise<ApiResult> {
    return this.api.get(`/login/${username}/${password}`, JSON_HEADERS);
  }

  async getCustomer(customerId: number): Promise<Customer> {
    const { body } = await this.api.get(`/customers/${customerId}`, JSON_HEADERS);
    return body as Customer;
  }

  /** Raw variant of getCustomer() — for asserting status/body on an unknown id (verified live: HTTP 400, plain-text body). */
  async getCustomerRaw(customerId: number): Promise<ApiResult> {
    return this.api.get(`/customers/${customerId}`, JSON_HEADERS);
  }

  /** Raw variant of getAccount() — for asserting status/body on an unknown id (verified live: HTTP 400, plain-text body). */
  async getAccountRaw(accountId: number): Promise<ApiResult> {
    return this.api.get(`/accounts/${accountId}`, JSON_HEADERS);
  }

  async getAccountsForCustomer(customerId: number): Promise<Account[]> {
    const { body } = await this.api.get(`/customers/${customerId}/accounts`, JSON_HEADERS);
    return body as Account[];
  }

  async getAccount(accountId: number): Promise<Account> {
    const { body } = await this.api.get(`/accounts/${accountId}`, JSON_HEADERS);
    return body as Account;
  }

  async getTransactions(accountId: number): Promise<Transaction[]> {
    const { body } = await this.api.get(`/accounts/${accountId}/transactions`, JSON_HEADERS);
    return body as Transaction[];
  }

  /** Funds the new account with $100 from `fromAccountId` (verified live) — mirrors the Open New Account UI flow. */
  async createAccount(
    customerId: number,
    newAccountType: (typeof AccountType)[keyof typeof AccountType],
    fromAccountId: number
  ): Promise<Account> {
    const { body } = await this.api.post(
      `/createAccount?customerId=${customerId}&newAccountType=${newAccountType}&fromAccountId=${fromAccountId}`,
      {},
      JSON_HEADERS
    );
    return body as Account;
  }

  /**
   * REST equivalent of the Transfer Funds UI form. Verified live to share
   * the UI's lenient business rules (no overdraft/zero/negative/same-account
   * validation — see specs/transfer-funds.md) but with different
   * error-handling mechanics: a non-numeric `amount` fails JAX-RS parameter
   * binding (HTTP 404, empty body) rather than the UI's 500 error panel, and
   * a missing required param produces an HTTP 500 whose body is a full HTML
   * error page (not a clean API error) — a real inconsistency worth
   * asserting on explicitly rather than working around.
   */
  async transfer(fromAccountId: number, toAccountId: number, amount: number | string): Promise<ApiResult> {
    return this.api.post(`/transfer?fromAccountId=${fromAccountId}&toAccountId=${toAccountId}&amount=${amount}`, {}, JSON_HEADERS);
  }

  /** Verified live: no minimum-balance validation, same as transfer()/withdraw(). */
  async deposit(accountId: number, amount: number | string): Promise<ApiResult> {
    return this.api.post(`/deposit?accountId=${accountId}&amount=${amount}`, {}, JSON_HEADERS);
  }

  /** Verified live: succeeds even past available balance — no overdraft protection. */
  async withdraw(accountId: number, amount: number | string): Promise<ApiResult> {
    return this.api.post(`/withdraw?accountId=${accountId}&amount=${amount}`, {}, JSON_HEADERS);
  }
}
