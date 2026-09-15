/**
 * CLI: the full Step 28 -> 29 -> 30 pipeline for the most recent Playwright
 * run — classify every failure, decide what's healable, and for anything
 * that's LOCATOR_CHANGED + healable, attempt a real LLM-assisted patch,
 * verified by re-running the exact test that failed.
 *
 * This is the last read-*and-write* step before CI hands off to git/PR
 * creation (Step 31, in the GitHub Actions workflow) — it never touches
 * git itself; it only leaves patched source files on disk (only for
 * verified-passing patches) plus an evidence artifact per attempt under
 * artifacts/healing/. The workflow decides what to do with any resulting
 * `git status` diff (open a PR) — this script has no opinion on that.
 *
 * Usage:
 *   npm run heal:failures                 # reads test-results/results.json
 *   npm run heal:failures -- path/to.json # or an explicit path
 *
 * Requires OPENAI_API_KEY to be set for any actual heal *attempt* (only
 * thrown lazily, inside proposeLocatorFix, so runs with zero healable
 * candidates never need it).
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { analyze, FailureClassification, FailureInput } from './FailureAnalyzer';
import { decideHealability, HealabilityVerdict } from './HealerAgent';
import { proposeLocatorFix } from './proposeLocatorFix';
import { applyLocatorPatch, runAffectedTestSync, PatchResult } from './PatchGenerator';
import { loadLatestFailures } from './buildFailureInput';

const DEFAULT_RESULTS_PATH = path.resolve(process.cwd(), 'test-results/results.json');
const PATCHES_DIR = path.resolve(process.cwd(), 'artifacts/healing/patches');

interface HealAttemptRecord {
  testTitle: string;
  testFile: string;
  classification: FailureClassification;
  healability: HealabilityVerdict;
  patch: PatchResult | null;
  skippedReason?: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
}

/** Best-effort — returns '' (not thrown) if the file isn't tracked yet or git isn't available; the reasoning.json is still saved either way. */
function gitDiffFor(filePath: string): string {
  try {
    return execFileSync('git', ['diff', '--', filePath], { cwd: process.cwd(), encoding: 'utf-8' });
  } catch {
    return '';
  }
}

function writeGithubOutput(key: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  fs.appendFileSync(outputFile, `${key}=${value}\n`);
}

async function attemptHeal(failure: FailureInput, classification: FailureClassification): Promise<PatchResult> {
  if (!classification.extractedLocator || !failure.errorLocation || !failure.fullDomPath) {
    return {
      applied: false,
      filePath: failure.errorLocation?.file ?? failure.testFile,
      reason:
        'Missing required evidence (extractedLocator / errorLocation / fullDomPath) — cannot attempt an automatic heal for this failure.',
    };
  }

  if (!fs.existsSync(failure.fullDomPath)) {
    return { applied: false, filePath: failure.errorLocation.file, reason: `full-dom attachment not found on disk at ${failure.fullDomPath}.` };
  }

  const domHtml = fs.readFileSync(failure.fullDomPath, 'utf-8');

  const proposal = await proposeLocatorFix({
    brokenLocatorLiteral: classification.extractedLocator,
    errorMessage: failure.errorMessage,
    domHtml,
    testSource: failure.testSource,
  });

  if (!proposal) {
    return { applied: false, filePath: failure.errorLocation.file, reason: 'The LLM did not return a usable replacement locator.' };
  }

  return applyLocatorPatch({
    filePath: failure.errorLocation.file,
    brokenLocatorLiteral: classification.extractedLocator,
    proposal,
    verify: async () => runAffectedTestSync(failure.testFile, failure.testTitle),
  });
}

async function main(): Promise<void> {
  const resultsPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_RESULTS_PATH;

  if (!fs.existsSync(resultsPath)) {
    console.error(`[heal-failures] No results file at ${resultsPath}. Run tests with the 'json' reporter first, then re-run this command.`);
    process.exitCode = 1;
    return;
  }

  const failures = loadLatestFailures(resultsPath);
  if (failures.length === 0) {
    console.log('[heal-failures] No failing tests found — nothing to heal.');
    writeGithubOutput('healed', 'false');
    writeGithubOutput('healedCount', '0');
    return;
  }

  fs.mkdirSync(PATCHES_DIR, { recursive: true });

  const records: HealAttemptRecord[] = [];

  for (const failure of failures) {
    const classification = analyze(failure);
    const healability = decideHealability(classification);

    if (!healability.healable) {
      records.push({ testTitle: failure.testTitle, testFile: failure.testFile, classification, healability, patch: null });
      continue;
    }

    if (classification.category !== 'LOCATOR_CHANGED') {
      // TIMING is the other currently-healable category (see HealerAgent.ts),
      // but this project's own Healer discipline (no waitForTimeout, no
      // increased timeouts — see the human Healer session this pipeline is
      // modeled on) means there is no safe automatic *patch* for it yet.
      records.push({
        testTitle: failure.testTitle,
        testFile: failure.testFile,
        classification,
        healability,
        patch: null,
        skippedReason: `${classification.category} is healable per HealerAgent, but no automatic patch strategy exists for it yet (only LOCATOR_CHANGED is currently supported).`,
      });
      continue;
    }

    let patch: PatchResult;
    try {
      patch = await attemptHeal(failure, classification);
    } catch (err) {
      patch = { applied: false, filePath: failure.errorLocation?.file ?? failure.testFile, reason: `Heal attempt threw: ${(err as Error).message}` };
    }

    records.push({ testTitle: failure.testTitle, testFile: failure.testFile, classification, healability, patch });

    if (patch.applied) {
      const slug = slugify(failure.testTitle);
      const diff = gitDiffFor(patch.filePath);
      if (diff) fs.writeFileSync(path.join(PATCHES_DIR, `${slug}.patch`), diff);
      fs.writeFileSync(
        path.join(PATCHES_DIR, `${slug}.reasoning.json`),
        JSON.stringify(
          {
            testTitle: failure.testTitle,
            testFile: failure.testFile,
            failureType: classification.category,
            filePath: patch.filePath,
            oldLocator: patch.oldExpression,
            newLocator: patch.newExpression,
            confidence: classification.confidence,
            testResult: 'PASS',
            timestamp: new Date().toISOString(),
          },
          null,
          2
        )
      );
    }
  }

  const healedCount = records.filter((r) => r.patch?.applied).length;

  console.log(`[heal-failures] ${records.length} failing test(s) processed, ${healedCount} healed:\n`);
  for (const record of records) {
    const verdict = record.patch?.applied ? 'HEALED' : record.healability.healable ? 'ATTEMPTED, NOT HEALED' : 'NOT HEALABLE';
    console.log(`  [${record.classification.category}] ${verdict} — ${record.testTitle}`);
    if (record.skippedReason) console.log(`      ${record.skippedReason}`);
    if (record.patch) console.log(`      ${record.patch.reason}`);
    console.log();
  }

  fs.writeFileSync(
    path.resolve(process.cwd(), `artifacts/healing/heal-summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify(records, null, 2)
  );

  writeGithubOutput('healed', healedCount > 0 ? 'true' : 'false');
  writeGithubOutput('healedCount', String(healedCount));
}

main().catch((err) => {
  console.error('[heal-failures] Unexpected error:', err);
  process.exitCode = 1;
});
