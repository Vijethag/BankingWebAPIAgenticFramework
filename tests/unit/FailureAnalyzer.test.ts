import { analyze, FailureInput } from '../../src/agents/healer/FailureAnalyzer';

/**
 * Several of these fixtures are verbatim (or near-verbatim) error messages
 * this project actually produced during earlier Planner/Generator/Healer
 * sessions — not invented strings. Where noted, see the corresponding spec
 * doc for the full incident.
 */

function input(overrides: Partial<FailureInput>): FailureInput {
  return {
    testTitle: 'some test',
    testFile: 'tests/ui/example.spec.ts',
    errorMessage: '',
    ...overrides,
  };
}

describe('FailureAnalyzer.analyze', () => {
  it('classifies a locator that never resolves as LOCATOR_CHANGED (real incident: LoginPage typo)', () => {
    // Verbatim from the Healer session: `usernameInput` was accidentally
    // pointed at `input[name="user name"]` (a typo) instead of the real
    // `input[name="username"]` attribute.
    const result = analyze(
      input({
        testTitle: '1.1 Valid registered user can login',
        errorMessage: [
          'Error: locator.fill: Test timeout of 30000ms exceeded.',
          'Call log:',
          '  - waiting for locator(\'input[name="user name"]\')',
        ].join('\n'),
      })
    );

    expect(result.category).toBe('LOCATOR_CHANGED');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.extractedLocator).toBe('input[name="user name"]');
  });

  it('classifies an assertion mismatch with a "resolved N times" call log as ASSERTION, not LOCATOR_CHANGED (real incident: jsessionid URL regex)', () => {
    // Verbatim shape from the original login.spec.ts URL-anchoring bug
    // (before it was fixed) — the locator/page WAS found repeatedly, the
    // assertion itself was simply too strict (`$`-anchored regex vs a
    // server-appended ";jsessionid=..." suffix). This must NOT be flagged
    // as a product defect — it was purely a test-side over-strict assertion.
    const result = analyze(
      input({
        testTitle: '1.1 Valid registered user can login',
        errorMessage: [
          'Error: expect(page).toHaveURL(expected) failed',
          '',
          'Expected pattern: /\\/overview\\.htm$/',
          'Received string:  "http://localhost:8080/parabank/login.htm;jsessionid=56E21E3E7613563B15B2B0C0F147FED3"',
          'Timeout: 5000ms',
          '',
          'Call log:',
          '  - Expect "toHaveURL" with timeout 5000ms',
          '    14 × locator resolved to <html>…</html>',
          '       - unexpected value "http://localhost:8080/parabank/login.htm;jsessionid=56E21E3E7613563B15B2B0C0F147FED3"',
        ].join('\n'),
      })
    );

    expect(result.category).toBe('ASSERTION');
  });

  it('classifies an invalid-credentials test unexpectedly reaching an authenticated page as PRODUCT_BUG (real incident: login concurrency race, specs/login-concurrency.md)', () => {
    const result = analyze(
      input({
        testTitle: '1.5 Invalid credentials show authentication error',
        errorMessage: [
          'Error: expect(page).toHaveURL(expected) failed',
          '',
          'Expected pattern: /\\/login\\.htm(;|$)/',
          'Received string:  "http://localhost:8080/parabank/overview.htm"',
          'Timeout: 5000ms',
          '',
          'Call log:',
          '  - Expect "toHaveURL" with timeout 5000ms',
          '    13 × locator resolved to <html>…</html>',
          '       - unexpected value "http://localhost:8080/parabank/overview.htm"',
        ].join('\n'),
      })
    );

    expect(result.category).toBe('PRODUCT_BUG');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('classifies a known ParaBank server error string appearing where success was expected as PRODUCT_BUG', () => {
    const result = analyze(
      input({
        testTitle: 'customer can register with a unique username',
        errorMessage: [
          'Error: expect(locator).toBeVisible() failed',
          '',
          'Locator: getByText(\'Welcome autouser123\')',
          'Expected: visible',
          'Received: <element(s) not found>',
        ].join('\n'),
        domSnapshot: 'heading "Error!"\nparagraph: This username already exists.',
      })
    );

    expect(result.category).toBe('PRODUCT_BUG');
  });

  it('classifies a plain UI-copy assertion mismatch (no business/auth signal) as ASSERTION', () => {
    const result = analyze(
      input({
        testTitle: 'footer copyright text is up to date',
        errorMessage: [
          'Error: expect(locator).toHaveText(expected) failed',
          '',
          "Locator: locator('footer p')",
          'Expected string: "© Parasoft. All rights reserved."',
          'Received string: "© Parasoft Corporation. All rights reserved."',
          'Timeout: 5000ms',
          '',
          'Call log:',
          '  - Expect "toHaveText" with timeout 5000ms',
          '    8 × locator resolved to <p>© Parasoft Corporation. All rights reserved.</p>',
          '       - unexpected value "© Parasoft Corporation. All rights reserved."',
        ].join('\n'),
      })
    );

    expect(result.category).toBe('ASSERTION');
  });

  it('classifies a business-numeric mismatch on a successful call as PRODUCT_BUG', () => {
    const result = analyze(
      input({
        testTitle: 'transfer moves the exact amount between two owned accounts',
        errorMessage: 'Error: expect(received).toBeCloseTo(expected)\n\nExpected: 975\nReceived: 1000',
        testSource: 'expect(fromAfter.balance).toBeCloseTo(fromBefore.balance - amount, 2);',
      })
    );

    expect(result.category).toBe('PRODUCT_BUG');
  });

  it('classifies a mid-test connection reset as NETWORK', () => {
    const result = analyze(
      input({
        errorMessage: 'apiRequestContext.get: read ECONNRESET',
      })
    );

    expect(result.category).toBe('NETWORK');
  });

  it('classifies a failed navigation to the base URL as ENVIRONMENT (app under test unreachable)', () => {
    const result = analyze(
      input({
        errorMessage:
          'page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8080/parabank/index.htm',
      })
    );

    expect(result.category).toBe('ENVIRONMENT');
  });

  it('classifies a browser launch failure as ENVIRONMENT', () => {
    const result = analyze(
      input({
        errorMessage:
          "browserType.launch: Executable doesn't exist at /Users/x/.cache/ms-playwright/chromium-1155/chrome-mac/Chromium.app",
      })
    );

    expect(result.category).toBe('ENVIRONMENT');
  });

  it('classifies a bare timeout with no locator/network signal as TIMING', () => {
    const result = analyze(
      input({
        errorMessage: 'Test timeout of 30000ms exceeded while running "afterEach" hook.',
      })
    );

    expect(result.category).toBe('TIMING');
  });

  it('falls back to UNKNOWN with zero confidence for an unrecognized error', () => {
    const result = analyze(
      input({
        errorMessage: 'Some completely unexpected internal test runner crash: SIGSEGV',
      })
    );

    expect(result.category).toBe('UNKNOWN');
    expect(result.confidence).toBe(0);
  });

  it('always returns the same classification for the same input (deterministic, no hidden state)', () => {
    const failure = input({
      errorMessage: "Error: locator.click: Test timeout of 30000ms exceeded.\nCall log:\n  - waiting for locator('#submit')",
    });

    expect(analyze(failure)).toEqual(analyze(failure));
  });
});
