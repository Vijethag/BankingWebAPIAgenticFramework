import * as fs from 'fs';
import * as path from 'path';

export interface ApiAccountsPoolEntry {
  checkingAccountId: number;
  savingsAccountId: number;
}

/** Generated at globalSetup time, gitignored — never committed. */
export const POOL_FILE = path.resolve(__dirname, '../../.generated/api-accounts-pool.json');

export function writePool(pool: ApiAccountsPoolEntry[]): void {
  fs.mkdirSync(path.dirname(POOL_FILE), { recursive: true });
  fs.writeFileSync(POOL_FILE, JSON.stringify(pool, null, 2));
}

export function readPool(): ApiAccountsPoolEntry[] {
  const raw = fs.readFileSync(POOL_FILE, 'utf-8');
  return JSON.parse(raw) as ApiAccountsPoolEntry[];
}
