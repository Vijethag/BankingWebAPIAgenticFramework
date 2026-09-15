/**
 * PatchGenerator — safely applies an already-*proposed* locator fix
 * (proposeLocatorFix.ts's job, not this file's) to a real source file, and
 * NEVER keeps the change unless the previously-failing test actually passes
 * against it afterwards. Matches the architecture plan's "Step 30" flow
 * exactly:
 *
 *   Create candidate change -> Git diff -> Run affected test -> Save patch
 *
 * This module is deliberately the *only* place that touches the
 * filesystem for healing, and it is fully deterministic and dependency-
 * injectable (readFile/writeFile/verify) precisely so it's unit-testable
 * without a real browser, a real LLM call, or real git — see
 * tests/unit/PatchGenerator.test.ts. The one real, non-test caller
 * (healFailures.ts) wires in the real fs functions and a real
 * `npx playwright test ...` verification run.
 *
 * Safety properties:
 *  - Never applies a proposal that doesn't look like a real Playwright
 *    locator expression (must start with "page.").
 *  - Always keeps the original file content in memory before writing, and
 *    restores it verbatim if verification fails for any reason (including
 *    the verify callback throwing) — a failed heal attempt never leaves a
 *    modified file behind.
 *  - Only ever changes the single line containing the broken locator
 *    literal; nothing else in the file is touched.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import type { LocatorFixProposal } from './proposeLocatorFix';

export interface ApplyLocatorPatchParams {
  filePath: string;
  /** The exact broken locator string FailureAnalyzer extracted, e.g. `input[name="user name"]` — used to find the line to patch. */
  brokenLocatorLiteral: string;
  proposal: LocatorFixProposal;
  /** Re-runs the specific test that was failing; must resolve true only if it now passes. */
  verify: () => Promise<boolean>;
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
}

export interface PatchResult {
  applied: boolean;
  filePath: string;
  oldExpression?: string;
  newExpression?: string;
  reason: string;
}

/** Matches a full `page.<method>(...)` call on one line — deliberately non-greedy on the args so it stops at the call's own closing paren, not a later one on the same line. */
const LOCATOR_CALL_PATTERN = /page\.\w+\([^)]*\)/;

function defaultReadFile(path: string): string {
  return fs.readFileSync(path, 'utf-8');
}

function defaultWriteFile(path: string, content: string): void {
  fs.writeFileSync(path, content, 'utf-8');
}

export async function applyLocatorPatch(params: ApplyLocatorPatchParams): Promise<PatchResult> {
  const { filePath, brokenLocatorLiteral, proposal, verify } = params;
  const readFile = params.readFile ?? defaultReadFile;
  const writeFile = params.writeFile ?? defaultWriteFile;

  if (!proposal.newLocatorExpression || !proposal.newLocatorExpression.startsWith('page.')) {
    return { applied: false, filePath, reason: 'Rejected: proposal is not a well-formed "page.<method>(...)" expression.' };
  }

  const originalContent = readFile(filePath);
  const lines = originalContent.split('\n');
  const targetLineIndex = lines.findIndex((line) => line.includes(brokenLocatorLiteral));

  if (targetLineIndex === -1) {
    return { applied: false, filePath, reason: `Broken locator literal "${brokenLocatorLiteral}" not found in ${filePath} — nothing to patch.` };
  }

  const targetLine = lines[targetLineIndex];
  const callMatch = targetLine.match(LOCATOR_CALL_PATTERN);
  if (!callMatch) {
    return {
      applied: false,
      filePath,
      reason: `Found the broken locator literal on line ${targetLineIndex + 1}, but couldn't isolate a "page.<method>(...)" call to replace on that line.`,
    };
  }

  const oldExpression = callMatch[0];
  lines[targetLineIndex] = targetLine.replace(oldExpression, proposal.newLocatorExpression);
  writeFile(filePath, lines.join('\n'));

  let verified = false;
  try {
    verified = await verify();
  } catch {
    verified = false;
  }

  if (!verified) {
    writeFile(filePath, originalContent);
    return {
      applied: false,
      filePath,
      oldExpression,
      newExpression: proposal.newLocatorExpression,
      reason: 'Patch applied but the previously-failing test still did not pass against it — reverted, not saved.',
    };
  }

  return {
    applied: true,
    filePath,
    oldExpression,
    newExpression: proposal.newLocatorExpression,
    reason: `Verified: the previously-failing test now passes with ${proposal.newLocatorExpression}.`,
  };
}

/**
 * Real (non-injected) verification step: re-runs exactly the one test that
 * was failing. `-g` matches the test title as a regex, so special
 * characters in the title are escaped first.
 *
 * Runs with `--output` pointed at a scratch directory rather than the
 * default `test-results/` — Playwright wipes its whole output directory at
 * the start of every run, and `healFailures.ts` processes *all* failures
 * from one shared `test-results/` in a single loop. Without this, verifying
 * the very first successful heal would delete the on-disk `full-dom`
 * evidence (see buildFailureInput.ts) for every other not-yet-processed
 * failure in the same batch, silently turning them all into "not healed"
 * regardless of whether they were actually healable (verified live — see
 * the CI run this comment was added in response to).
 */
export function runAffectedTestSync(testFile: string, testTitle: string, project = 'ui-chromium'): boolean {
  const escapedTitle = testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    execFileSync(
      'npx',
      ['playwright', 'test', testFile, '--project', project, '-g', escapedTitle, '--output', 'test-results-verify'],
      {
        stdio: 'pipe',
        timeout: 60_000,
      }
    );
    return true;
  } catch {
    return false;
  }
}
