/**
 * Adapters that turn real Playwright output into FailureAnalyzer's
 * `FailureInput` — nothing here does any classification, it only extracts
 * and shapes evidence:
 *
 *   1. `parseErrorContextMarkdown` — parses one `error-context.md` file
 *      (Playwright writes exactly one per failed test; format confirmed by
 *      reading `node_modules/playwright/lib/errorContext.js` /
 *      `buildErrorContext()`) into its three sections: error details, the
 *      DOM ("Page snapshot") aria-snapshot, and the test-source code frame.
 *   2. `buildFailureInputFromResult` — combines a JSON-reporter test result
 *      (title/file/error) with its `error-context` attachment into a single
 *      `FailureInput`.
 *   3. `loadLatestFailures` — walks a full `results.json` (from Playwright's
 *      built-in `json` reporter) and returns one `FailureInput` per
 *      non-passing test result.
 */

import * as fs from 'fs';
import type { FailureInput } from './FailureAnalyzer';

export interface ParsedErrorContext {
  errorMessage?: string;
  domSnapshot?: string;
  testSource?: string;
}

/**
 * Pulls every fenced code block within a given markdown section (from the
 * heading up to the next "# " heading or end of file) and joins them.
 *
 * Verified against a *real* generated error-context.md: "# Error details"
 * can contain **two** fenced blocks per error — Playwright's own
 * `buildErrorContext()` writes one block for the plain `error.message` and,
 * when present, a second one with the full call log (the "waiting for
 * locator(...)" detail lives in that second block, not the first) — so
 * grabbing only the first fenced block silently drops the most useful part.
 */
function extractSectionBody(markdown: string, heading: string): string | undefined {
  const headingIndex = markdown.indexOf(heading);
  if (headingIndex === -1) return undefined;

  const afterHeading = markdown.slice(headingIndex + heading.length);
  const nextHeadingIndex = afterHeading.search(/\n# /);
  const section = nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex);

  const blocks = [...section.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1].replace(/\n$/, ''));
  return blocks.length > 0 ? blocks.join('\n\n') : undefined;
}

export function parseErrorContextMarkdown(markdown: string): ParsedErrorContext {
  return {
    errorMessage: extractSectionBody(markdown, '# Error details'),
    domSnapshot: extractSectionBody(markdown, '# Page snapshot'),
    testSource: extractSectionBody(markdown, '# Test source'),
  };
}

/** Strips ANSI color/style escape codes — Playwright's raw JSON-reporter error messages carry these (verified live), but its own error-context.md is already clean. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * The JSON reporter's `errors` array can hold multiple recorded errors per
 * result — verified live: index 0 is often the generic "Test timeout of
 * 30000ms exceeded.", while the *last* entry carries the specific,
 * actionable one (e.g. "locator.fill: ... Call log: - waiting for
 * locator(...)"), matching Playwright's own convention of using the last
 * error to build its code frame (see errorContext.js `buildErrorContext`).
 */
function mostSpecificError(result: JSONReportTestResult): JSONReportError | undefined {
  if (result.errors && result.errors.length > 0) return result.errors[result.errors.length - 1];
  return result.error;
}

/**
 * Minimal shape of Playwright's `json` reporter output — only the fields
 * this module actually reads. See
 * https://playwright.dev/docs/test-reporters#json-reporter for the full
 * schema; suites nest recursively (file suite -> describe suite(s) -> specs).
 */
export interface JSONReportAttachment {
  name: string;
  path?: string;
  contentType: string;
}

export interface JSONReportErrorLocation {
  file: string;
  line: number;
  column: number;
}

export interface JSONReportError {
  message?: string;
  stack?: string;
  location?: JSONReportErrorLocation;
}

export interface JSONReportTestResult {
  status: 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'skipped';
  error?: JSONReportError;
  errors?: JSONReportError[];
  attachments?: JSONReportAttachment[];
}

export interface JSONReportTest {
  results: JSONReportTestResult[];
}

export interface JSONReportSpec {
  title: string;
  file: string;
  tests: JSONReportTest[];
}

export interface JSONReportSuite {
  title?: string;
  specs?: JSONReportSpec[];
  suites?: JSONReportSuite[];
}

export interface JSONReport {
  suites: JSONReportSuite[];
}

function findAttachmentPath(result: JSONReportTestResult, name: string): string | undefined {
  return result.attachments?.find((a) => a.name === name)?.path;
}

/**
 * Combines one JSON-reporter test result with its `error-context`
 * attachment (read from disk) into a `FailureInput`. `errorMessage` prefers
 * the JSON reporter's own structured error, falling back to the markdown's
 * "# Error details" section if that's ever unavailable.
 */
export function buildFailureInputFromResult(
  spec: { title: string; file: string },
  result: JSONReportTestResult
): FailureInput {
  const errorContextPath = findAttachmentPath(result, 'error-context');
  let parsedContext: ParsedErrorContext = {};

  if (errorContextPath && fs.existsSync(errorContextPath)) {
    parsedContext = parseErrorContextMarkdown(fs.readFileSync(errorContextPath, 'utf-8'));
  }

  const specificError = mostSpecificError(result);
  const errorMessage = specificError?.message ? stripAnsi(specificError.message) : undefined;
  const errorStack = specificError?.stack ? stripAnsi(specificError.stack) : undefined;

  return {
    testTitle: spec.title,
    testFile: spec.file,
    errorMessage: errorMessage || parsedContext.errorMessage || '',
    errorStack,
    domSnapshot: parsedContext.domSnapshot,
    testSource: parsedContext.testSource,
    tracePath: findAttachmentPath(result, 'trace'),
    screenshotPath: findAttachmentPath(result, 'screenshot'),
    errorLocation: specificError?.location,
    fullDomPath: findAttachmentPath(result, 'full-dom'),
  };
}

/** Recursively collects every spec across a possibly-nested suite tree. */
function collectSpecs(suites: JSONReportSuite[]): JSONReportSpec[] {
  const specs: JSONReportSpec[] = [];
  for (const suite of suites) {
    if (suite.specs) specs.push(...suite.specs);
    if (suite.suites) specs.push(...collectSpecs(suite.suites));
  }
  return specs;
}

/**
 * Reads a Playwright `json` reporter output file and returns one
 * `FailureInput` per non-passing test result (failed/timedOut/interrupted —
 * skipped tests are excluded, they never ran).
 */
export function loadLatestFailures(resultsJsonPath: string): FailureInput[] {
  const raw = fs.readFileSync(resultsJsonPath, 'utf-8');
  const report = JSON.parse(raw) as JSONReport;

  const failures: FailureInput[] = [];
  for (const spec of collectSpecs(report.suites)) {
    for (const test of spec.tests) {
      for (const result of test.results) {
        if (result.status === 'failed' || result.status === 'timedOut' || result.status === 'interrupted') {
          failures.push(buildFailureInputFromResult(spec, result));
        }
      }
    }
  }
  return failures;
}
