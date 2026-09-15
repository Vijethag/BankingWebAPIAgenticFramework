import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

/**
 * Environment selection
 * ----------------------
 * ENV unset / "local" -> config/.env
 * ENV=qa               -> config/.env.qa
 * ENV=stage            -> config/.env.stage
 *
 * All environments currently point at a self-hosted ParaBank Docker
 * instance (see config/.env.example) — the public demo proved too
 * unstable (frequent HTTP 500s) for deterministic test runs.
 */
const ENV = process.env.ENV;
const envFile = ENV ? `config/.env.${ENV}` : 'config/.env';
// `quiet: true` suppresses dotenv's random promotional console "tips" so CI logs stay clean.
dotenv.config({ path: path.resolve(__dirname, envFile), quiet: true });

console.log(
  `[playwright.config] ENV="${ENV ?? 'local'}" | UI_BASE_URL=${process.env.UI_BASE_URL} | API_BASE_URL=${process.env.API_BASE_URL}`
);

export default defineConfig({
  testDir: './tests',

  /* Sequentially provisions one isolated account pair per worker for
   * tests/api/ before any worker starts — required to avoid a confirmed
   * ParaBank concurrency bug in POST /createAccount (see globalSetup.ts). */
  globalSetup: './globalSetup.ts',

  /* Run test files in parallel; each spec still runs as an isolated file. */
  fullyParallel: true,

  /* Fail the CI build if `test.only` was accidentally left in the source. */
  forbidOnly: !!process.env.CI,

  /* Retry flaky-looking failures on CI only — never masks a failure locally. */
  retries: process.env.CI ? 2 : 0,

  /* Cap parallel workers on CI; unlimited (auto) locally. */
  workers: process.env.CI ? 2 : undefined,

  /* Per-test and per-assertion timeouts. */
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },

  // `json` gives the FailureAnalyzer (src/agents/healer) a structured,
  // machine-readable run to classify — everything else (trace/screenshot/
  // error-context.md) is already produced per-test regardless of reporter.
  reporter: process.env.CI
    ? [
      ['github'],
      ['list'],
      ['html', { outputFolder: 'reports/html-report', open: 'never' }],
      ['json', { outputFile: 'test-results/results.json' }],
      // Enable once `allure-playwright` + `allure-commandline` are installed:
      // ['allure-playwright', { outputFolder: 'allure-results', suiteTitle: true }],
    ]
    : [
      ['list'],
      ['html', { outputFolder: 'reports/html-report', open: 'never' }],
      ['json', { outputFile: 'test-results/results.json' }],
    ],

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: !!process.env.CI,
  },

  /*
   * UI and API automation are split into their own projects so each gets the
   * correct baseURL and only UI tests pay for a browser context.
   */
  projects: [
    {
      name: 'ui-chromium',
      testDir: './tests/ui',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.UI_BASE_URL,
      },
    },
    {
      name: 'api',
      testDir: './tests/api',
      use: {
        baseURL: process.env.API_BASE_URL,
      },
    },
  ],
});
