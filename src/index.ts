// Barrel exports — the framework's public surface (package model: consumers
// import from the package root, never reach into src/pages or src/api directly).

export { BasePage } from './pages/BasePage';
export { LoginPage } from './pages/LoginPage';
export { RegisterPage } from './pages/RegisterPage';
export type { RegistrationData } from './pages/RegisterPage';
export { TransferFundsPage } from './pages/TransferFundsPage';
export { AccountsOverviewPage } from './pages/AccountsOverviewPage';

export { ApiHelper } from './api/ApiHelper';
export type { ApiResult } from './api/ApiHelper';
export { AccountClient, AccountType } from './api/AccountClient';
export type { Account, Customer, Transaction } from './api/AccountClient';

export { test, expect, SEEDED_USER, SEEDED_CUSTOMER_ID, TRANSFER_ACCOUNTS } from './fixtures/base';
export type { ApiTestAccounts } from './fixtures/base';
export { readPool, writePool, POOL_FILE } from './setup/apiAccountsPool';
export type { ApiAccountsPoolEntry } from './setup/apiAccountsPool';

export { formatParaBankAmount } from './utils/formatCurrency';
export { UserFactory } from './utils/UserFactory';

export { analyze } from './agents/healer/FailureAnalyzer';
export type { FailureCategory, FailureInput, FailureClassification } from './agents/healer/FailureAnalyzer';
export { decideHealability, MIN_HEALABLE_CONFIDENCE } from './agents/healer/HealerAgent';
export type { HealabilityVerdict } from './agents/healer/HealerAgent';
export { proposeLocatorFix } from './agents/healer/proposeLocatorFix';
export type { LocatorFixProposal, ProposeLocatorFixInput } from './agents/healer/proposeLocatorFix';
export { applyLocatorPatch, runAffectedTestSync } from './agents/healer/PatchGenerator';
export type { ApplyLocatorPatchParams, PatchResult } from './agents/healer/PatchGenerator';
export {
  parseErrorContextMarkdown,
  buildFailureInputFromResult,
  loadLatestFailures,
} from './agents/healer/buildFailureInput';
export type {
  ParsedErrorContext,
  JSONReport,
  JSONReportSuite,
  JSONReportSpec,
  JSONReportTest,
  JSONReportTestResult,
  JSONReportError,
  JSONReportErrorLocation,
  JSONReportAttachment,
} from './agents/healer/buildFailureInput';
