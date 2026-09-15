/**
 * FailureAnalyzer — deterministic, rule-based classification of a failed
 * Playwright test.
 *
 * Scope (intentional): this is *only* the classifier (architecture plan
 * "Step 28"). It does not decide whether a failure is safe to auto-heal
 * (that's the Healer's job, with its own strict guardrails — a separate,
 * later step), and it does not call an LLM. Classification is pure,
 * deterministic, and unit-testable: same input always produces the same
 * output. This matches the project's own stated philosophy — build a
 * solid deterministic framework first, layer AI on top only once that's
 * stable.
 *
 * Inputs map onto Playwright artifacts that already exist for every failed
 * test — no new instrumentation required (see buildFailureInput.ts for how
 * these are extracted from `error-context.md` + the JSON reporter output):
 *   - errorMessage / errorStack -> TestResult.error
 *   - domSnapshot               -> the "# Page snapshot" section of
 *                                   error-context.md (Playwright's own
 *                                   aria-snapshot-at-time-of-failure)
 *   - testSource                -> the "# Test source" code-frame section
 *                                   of error-context.md (failing line is
 *                                   prefixed with "> ")
 *   - tracePath / screenshotPath -> attachment file paths, carried through
 *                                   as evidence references only (binary/zip
 *                                   content is not parsed here)
 */

export type FailureCategory =
  | 'LOCATOR_CHANGED'
  | 'TIMING'
  | 'NETWORK'
  | 'ENVIRONMENT'
  | 'ASSERTION'
  | 'PRODUCT_BUG'
  | 'UNKNOWN';

export interface FailureInput {
  testTitle: string;
  testFile: string;
  errorMessage: string;
  errorStack?: string;
  domSnapshot?: string;
  testSource?: string;
  /** Only set if already known by the caller — analyze() derives its own regardless (see extractedLocator). */
  locator?: string;
  tracePath?: string;
  screenshotPath?: string;
  /**
   * Source file/line of the *specific* error (from the JSON reporter's
   * `errors[].location`) — not used by classification, only carried
   * through as evidence for the Healer (Step 30): for this project's Page
   * Object convention, the failing call site and the locator's own
   * declaration live in the same file.
   */
  errorLocation?: { file: string; line: number; column: number };
  /**
   * Path to the full raw DOM HTML captured on failure (see the `page`
   * fixture override in src/fixtures/base.ts) — not used by classification
   * (kept as a path, not inlined content, so building a FailureInput stays
   * cheap); the Healer reads it lazily only when actually attempting an
   * LLM-assisted locator fix.
   */
  fullDomPath?: string;
}

export interface FailureClassification {
  category: FailureCategory;
  /** 0 (no signal) to 1 (very confident). */
  confidence: number;
  /** Short, human-readable explanation of why this category was chosen. */
  reasoning: string;
  /** The specific text snippets/signals that drove the decision. */
  evidence: string[];
  /** Locator string pulled out of the error message / code frame, if any. */
  extractedLocator?: string;
}

// ---------------------------------------------------------------------------
// Shared text helpers
// ---------------------------------------------------------------------------

/**
 * Known ParaBank server-rendered error strings (verified live across this
 * project's own exploration — see specs/parabank-login.md, specs/rest-api.md,
 * specs/login-concurrency.md). Seeing one of these in an *actual* value where
 * a success was expected is a strong signal the app itself misbehaved, not
 * that the test's assertion/locator is wrong.
 */
const KNOWN_APP_ERROR_STRINGS = [
  'could not be verified',
  'already exists',
  'internal error has occurred',
  'Please enter a username and password',
];

const BUSINESS_KEYWORDS = /\b(balance|amount|total|overdraft|transfer|deposit|withdraw)\b/i;

const AUTH_KEYWORDS = /\b(invalid|unauthorized|unauthenticated|wrong|bad)\b.*\b(credentials?|login|password|username|auth)\b/i;

function extractLocator(errorMessage: string, testSource?: string): string | undefined {
  const messagePatterns: RegExp[] = [
    /waiting for locator\((['"])(.+?)\1\)/,
    /waiting for (getBy\w+\([^)]*\))/,
    /locator\(['"](.+?)['"]\)/,
  ];
  for (const pattern of messagePatterns) {
    const match = errorMessage.match(pattern);
    if (match) return match[2] ?? match[1];
  }

  if (testSource) {
    // error-context.md's code frame prefixes the failing line with "> ".
    const failingLine = testSource.split('\n').find((line) => /^>\s*\d+\s*\|/.test(line));
    if (failingLine) {
      const match = failingLine.match(/(locator\((['"]).+?\2\)|getBy\w+\([^)]*\))/);
      if (match) return match[0];
    }
  }

  return undefined;
}

/** Highest "N" from any "N × locator resolved to ..." line — i.e. did the element ever actually get found? */
function countLocatorResolutions(errorMessage: string): number {
  const matches = [...errorMessage.matchAll(/(\d+)\s*×\s*locator resolved to/g)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map((m) => Number(m[1])));
}

function isActionTimeout(errorMessage: string): boolean {
  return /^(?:Error: )?locator\.(fill|click|check|uncheck|selectOption|type|press|hover|dblclick|tap)\b/m.test(
    errorMessage
  );
}

function isAssertionFailure(errorMessage: string): boolean {
  return (
    /^(?:Error: )?expect\(/m.test(errorMessage) ||
    /Expected (pattern|string|value|substring)/i.test(errorMessage) ||
    /Received (string|value)/i.test(errorMessage)
  );
}

function findKnownAppErrorString(text: string): string | undefined {
  return KNOWN_APP_ERROR_STRINGS.find((needle) => text.includes(needle));
}

/** Defense in depth: analyze() shouldn't assume the caller pre-sanitized raw Playwright output (which carries ANSI color codes — verified live via the JSON reporter). */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function combinedText(input: FailureInput): string {
  return [input.errorMessage, input.errorStack, input.domSnapshot, input.testSource].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Rules — evaluated in order, first match wins. Keep each rule narrowly
// scoped and independently testable; add new rules here rather than
// entangling conditions across categories.
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  run(input: FailureInput, ctx: { locator?: string; resolutions: number }): Omit<FailureClassification, 'extractedLocator'> | null;
}

const rules: Rule[] = [
  {
    id: 'environment-browser-launch',
    run(input) {
      if (/browserType\.launch/.test(input.errorMessage) || /Executable doesn't exist/i.test(input.errorMessage)) {
        return {
          category: 'ENVIRONMENT',
          confidence: 0.95,
          reasoning: 'The browser binary itself failed to launch — this is a test-runner/environment setup problem, not an application or locator issue.',
          evidence: ['browserType.launch failure detected in error message'],
        };
      }
      return null;
    },
  },
  {
    id: 'environment-unreachable-baseurl',
    run(input) {
      const gotoConnectionFailure =
        /page\.goto:.*(net::ERR_CONNECTION_REFUSED|net::ERR_NAME_NOT_RESOLVED|net::ERR_CONNECTION_RESET|ECONNREFUSED)/.test(
          input.errorMessage
        );
      if (gotoConnectionFailure) {
        return {
          category: 'ENVIRONMENT',
          confidence: 0.9,
          reasoning: 'The very first navigation to the base URL failed to connect — the application under test (or its host) is not reachable at all, which is an environment/setup problem rather than a flaky mid-test network blip.',
          evidence: ['page.goto connection failure to baseURL'],
        };
      }
      if (/(is not defined|is undefined|Missing required environment variable)/i.test(input.errorMessage) && /env/i.test(input.errorMessage)) {
        return {
          category: 'ENVIRONMENT',
          confidence: 0.85,
          reasoning: 'Error indicates a required environment variable/config value is missing.',
          evidence: ['missing environment variable/config signal in error message'],
        };
      }
      return null;
    },
  },
  {
    id: 'locator-changed',
    run(input, ctx) {
      if (isActionTimeout(input.errorMessage) && /waiting for (locator|getBy\w+)\(/.test(input.errorMessage) && ctx.resolutions === 0) {
        return {
          category: 'LOCATOR_CHANGED',
          confidence: 0.9,
          reasoning: 'An action (fill/click/...) timed out waiting for a locator that never resolved to any element at all (no "N × locator resolved to" retries logged) — the selector most likely no longer matches anything in the current DOM.',
          evidence: [ctx.locator ? `locator never resolved: ${ctx.locator}` : 'locator never resolved to any element'],
        };
      }
      return null;
    },
  },
  {
    id: 'network-transient',
    run(input) {
      const networkPatterns = [
        /net::ERR_/,
        /ECONNRESET/,
        /ECONNREFUSED/,
        /socket hang up/i,
        /fetch failed/i,
        /getaddrinfo ENOTFOUND/,
        /\b(502|503|504)\b.*(status|gateway)/i,
      ];
      // page.goto-to-baseURL cases are handled by the environment rule above and
      // take precedence (rule order), so anything reaching here is a *mid-test*
      // network hiccup — the app was already reachable.
      const matched = networkPatterns.find((p) => p.test(input.errorMessage));
      if (matched) {
        return {
          category: 'NETWORK',
          confidence: 0.8,
          reasoning: 'A transient, connection-level failure occurred mid-test (after the app was already reachable) — most likely a network blip rather than a broken locator or a real product defect.',
          evidence: [`matched network error pattern: ${matched}`],
        };
      }
      return null;
    },
  },
  {
    id: 'product-bug-known-app-error-text',
    run(input) {
      if (!isAssertionFailure(input.errorMessage)) return null;
      const text = combinedText(input);
      const knownError = findKnownAppErrorString(text);
      if (knownError) {
        return {
          category: 'PRODUCT_BUG',
          confidence: 0.85,
          reasoning: `The assertion failed because the application itself rendered a known error condition ("${knownError}") where success was expected — this reflects real application behavior, not a broken assertion or locator.`,
          evidence: [`known app error text present: "${knownError}"`],
        };
      }
      return null;
    },
  },
  {
    id: 'product-bug-auth-bypass',
    run(input) {
      if (!isAssertionFailure(input.errorMessage)) return null;
      const titleSuggestsNegativeAuth = AUTH_KEYWORDS.test(input.testTitle) || /invalid|unauthorized/i.test(input.testTitle);
      const receivedLooksAuthenticated = /overview\.htm|Accounts Overview|Welcome /.test(input.errorMessage);
      // Note: `\.` tolerates Playwright printing a regex *pattern* verbatim
      // (e.g. "Expected pattern: /\/login\.htm(;|$)/" contains a literal
      // backslash before the dot), as well as a plain URL like "login.htm".
      const expectedLoginOrRejection = /login\\?\.htm|Error!|not\.toHaveURL/.test(input.errorMessage);
      if (titleSuggestsNegativeAuth && receivedLooksAuthenticated && expectedLoginOrRejection) {
        return {
          category: 'PRODUCT_BUG',
          confidence: 0.9,
          reasoning: 'A negative-auth scenario (invalid/unauthorized credentials) unexpectedly reached an authenticated page — this matches a known class of server-side auth race condition (see specs/login-concurrency.md), not a test defect.',
          evidence: ['negative-auth test title', 'received value indicates an authenticated session was reached'],
        };
      }
      return null;
    },
  },
  {
    id: 'product-bug-business-numeric-mismatch',
    run(input) {
      if (!isAssertionFailure(input.errorMessage)) return null;
      const businessContext = BUSINESS_KEYWORDS.test(input.testTitle) || BUSINESS_KEYWORDS.test(input.testSource ?? '');
      const numericMismatch = /toBeCloseTo|toBe\(-?\d/.test(input.errorMessage) && /-?\$?\d+(\.\d+)?/.test(input.errorMessage);
      if (businessContext && numericMismatch) {
        return {
          category: 'PRODUCT_BUG',
          confidence: 0.7,
          reasoning: 'A business-numeric value (balance/amount/total) did not match the expected result even though the underlying call succeeded — this points to incorrect application data, not a UI mechanics problem.',
          evidence: ['business-domain keyword near a numeric assertion mismatch'],
        };
      }
      return null;
    },
  },
  {
    id: 'timing-generic',
    run(input) {
      if (isAssertionFailure(input.errorMessage)) return null;
      const isBareTimeout = /Timeout of \d+ms exceeded|Test timeout of \d+ms exceeded/.test(input.errorMessage);
      const mentionsLocator = /waiting for (locator|getBy\w+)\(/.test(input.errorMessage);
      if (isBareTimeout && !mentionsLocator) {
        return {
          category: 'TIMING',
          confidence: 0.55,
          reasoning: 'A generic timeout occurred with no specific locator or network signal in the error — likely a slow step/condition rather than a broken selector or connectivity problem.',
          evidence: ['bare timeout message with no locator/network signal'],
        };
      }
      return null;
    },
  },
  {
    id: 'assertion-default',
    run(input) {
      if (isAssertionFailure(input.errorMessage)) {
        return {
          category: 'ASSERTION',
          confidence: 0.6,
          reasoning: 'A well-formed expect(...) assertion failed against content that was actually found on the page/response — a plain expected-vs-actual mismatch with no known app-defect or business-data signal.',
          evidence: ['expect(...) assertion failure without a product-bug or locator signal'],
        };
      }
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyze(rawInput: FailureInput): FailureClassification {
  const input: FailureInput = {
    ...rawInput,
    errorMessage: stripAnsi(rawInput.errorMessage),
    errorStack: rawInput.errorStack ? stripAnsi(rawInput.errorStack) : undefined,
  };
  const locator = input.locator ?? extractLocator(input.errorMessage, input.testSource);
  const resolutions = countLocatorResolutions(input.errorMessage);
  const ctx = { locator, resolutions };

  for (const rule of rules) {
    const result = rule.run(input, ctx);
    if (result) {
      return { ...result, extractedLocator: locator };
    }
  }

  return {
    category: 'UNKNOWN',
    confidence: 0,
    reasoning: 'No classification rule matched this failure with confidence — needs manual triage.',
    evidence: [],
    extractedLocator: locator,
  };
}
