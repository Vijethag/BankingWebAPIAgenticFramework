import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseErrorContextMarkdown,
  buildFailureInputFromResult,
  loadLatestFailures,
  JSONReport,
} from '../../src/agents/healer/buildFailureInput';

/**
 * This markdown shape is not guessed — it mirrors exactly what
 * `buildErrorContext()` in `node_modules/playwright/lib/errorContext.js`
 * writes to `error-context.md` for every failed test (Test info / Error
 * details / Page snapshot / Test source sections, each error/snapshot in
 * its own fenced code block).
 */
const SAMPLE_ERROR_CONTEXT_MD = `# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ParaBank Login >> 1.2 Empty username shows validation error
- Location: tests/ui/login.spec.ts:46:7

# Error details

\`\`\`
Error: expect(locator).toBeVisible() failed

Locator: locator('input[name="username"]')
Expected: visible
Received: <element(s) not found>
\`\`\`

# Page snapshot

\`\`\`yaml
- heading "Error!" [level=1]
- paragraph: Please enter a username and password.
\`\`\`

# Test source

\`\`\`ts
  44 |   test('1.2 Empty username shows validation error', async ({ page, loginPage }) => {
  45 |     await loginPage.goto();
> 46 |     await expect(loginPage.missingCredentialsError).toBeVisible();
     |                                                      ^
  47 |     await loginPage.login('', SEEDED_USER.password);
  48 |   });
\`\`\`
`;

describe('parseErrorContextMarkdown', () => {
  it('extracts the error details, page snapshot, and test source fenced blocks', () => {
    const parsed = parseErrorContextMarkdown(SAMPLE_ERROR_CONTEXT_MD);

    expect(parsed.errorMessage).toContain('expect(locator).toBeVisible() failed');
    expect(parsed.domSnapshot).toContain('Please enter a username and password.');
    expect(parsed.testSource).toContain("await expect(loginPage.missingCredentialsError).toBeVisible();");
    expect(parsed.testSource).toMatch(/^>\s*46\s*\|/m);
  });

  it('returns undefined sections when a heading is missing entirely', () => {
    const parsed = parseErrorContextMarkdown('# Test info\n\n- Name: some test\n');

    expect(parsed.errorMessage).toBeUndefined();
    expect(parsed.domSnapshot).toBeUndefined();
    expect(parsed.testSource).toBeUndefined();
  });

  it('joins multiple fenced blocks under "# Error details" (real Playwright output can emit two — a generic message, then the detailed call log)', () => {
    // Trimmed from a real generated error-context.md (the LoginPage locator
    // typo incident): buildErrorContext() writes one fenced block per
    // recorded error, and the second, more useful one (with the actual
    // "waiting for locator(...)" call log) is easy to silently drop if only
    // the first fenced block is captured.
    const realShape = `# Error details

\`\`\`
Test timeout of 30000ms exceeded.
\`\`\`

\`\`\`
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('input[name="user name"]')
\`\`\`

# Page snapshot

\`\`\`yaml
- heading "Customer Login" [level=2]
\`\`\`
`;

    const parsed = parseErrorContextMarkdown(realShape);

    expect(parsed.errorMessage).toContain('Test timeout of 30000ms exceeded.');
    expect(parsed.errorMessage).toContain("waiting for locator('input[name=\"user name\"]')");
  });
});

describe('buildFailureInputFromResult', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-analyzer-test-'));
  const errorContextPath = path.join(tmpDir, 'error-context.md');

  beforeAll(() => {
    fs.writeFileSync(errorContextPath, SAMPLE_ERROR_CONTEXT_MD);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('merges the JSON reporter error with the error-context.md attachment', () => {
    const result = buildFailureInputFromResult(
      { title: '1.2 Empty username shows validation error', file: 'tests/ui/login.spec.ts' },
      {
        status: 'failed',
        error: { message: 'expect(locator).toBeVisible() failed', stack: 'at tests/ui/login.spec.ts:46:5' },
        attachments: [
          { name: 'error-context', path: errorContextPath, contentType: 'text/markdown' },
          { name: 'screenshot', path: '/tmp/screenshot.png', contentType: 'image/png' },
          { name: 'trace', path: '/tmp/trace.zip', contentType: 'application/zip' },
        ],
      }
    );

    expect(result.testTitle).toBe('1.2 Empty username shows validation error');
    expect(result.errorMessage).toBe('expect(locator).toBeVisible() failed');
    expect(result.domSnapshot).toContain('Please enter a username and password.');
    expect(result.testSource).toContain('missingCredentialsError');
    expect(result.screenshotPath).toBe('/tmp/screenshot.png');
    expect(result.tracePath).toBe('/tmp/trace.zip');
  });

  it('falls back to the error-context.md "# Error details" text when no structured error is present', () => {
    const result = buildFailureInputFromResult(
      { title: 'some test', file: 'tests/ui/example.spec.ts' },
      {
        status: 'failed',
        attachments: [{ name: 'error-context', path: errorContextPath, contentType: 'text/markdown' }],
      }
    );

    expect(result.errorMessage).toContain('expect(locator).toBeVisible() failed');
  });

  it('tolerates a missing error-context attachment entirely', () => {
    const result = buildFailureInputFromResult(
      { title: 'some test', file: 'tests/ui/example.spec.ts' },
      { status: 'failed', error: { message: 'boom' } }
    );

    expect(result.errorMessage).toBe('boom');
    expect(result.domSnapshot).toBeUndefined();
  });

  it('prefers the LAST entry of the errors[] array and strips ANSI codes (real incident: JSON reporter puts the generic timeout first and the specific locator error last, both ANSI-colored)', () => {
    const result = buildFailureInputFromResult(
      { title: '1.1 Valid registered user can login', file: 'tests/ui/login.spec.ts' },
      {
        status: 'timedOut',
        errors: [
          { message: '\u001b[31mTest timeout of 30000ms exceeded.\u001b[39m' },
          {
            message:
              'Error: locator.fill: Test timeout of 30000ms exceeded.\nCall log:\n\u001b[2m  - waiting for locator(\'input[name="user name"]\')\u001b[22m',
          },
        ],
      }
    );

    expect(result.errorMessage).toContain("waiting for locator('input[name=\"user name\"]')");
    expect(result.errorMessage).not.toContain('\u001b[31m');
    expect(result.errorMessage).not.toContain('\u001b[2m');
  });
});

describe('loadLatestFailures', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'failure-analyzer-results-'));
  const resultsPath = path.join(tmpDir, 'results.json');

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('walks nested suites and returns one FailureInput per non-passing result, skipping passed/skipped', () => {
    const report: JSONReport = {
      suites: [
        {
          title: 'login.spec.ts',
          specs: [
            {
              title: 'passing test',
              file: 'tests/ui/login.spec.ts',
              tests: [{ results: [{ status: 'passed' }] }],
            },
          ],
          suites: [
            {
              title: 'ParaBank Login',
              specs: [
                {
                  title: 'a failing test',
                  file: 'tests/ui/login.spec.ts',
                  tests: [{ results: [{ status: 'failed', error: { message: 'boom' } }] }],
                },
                {
                  title: 'a skipped test',
                  file: 'tests/ui/login.spec.ts',
                  tests: [{ results: [{ status: 'skipped' }] }],
                },
                {
                  title: 'a timed-out test',
                  file: 'tests/ui/login.spec.ts',
                  tests: [{ results: [{ status: 'timedOut', error: { message: 'too slow' } }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    fs.writeFileSync(resultsPath, JSON.stringify(report));

    const failures = loadLatestFailures(resultsPath);

    expect(failures).toHaveLength(2);
    expect(failures.map((f) => f.testTitle)).toEqual(['a failing test', 'a timed-out test']);
    expect(failures.map((f) => f.errorMessage)).toEqual(['boom', 'too slow']);
  });
});
