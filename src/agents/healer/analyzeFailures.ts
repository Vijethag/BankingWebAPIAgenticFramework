/**
 * CLI: classify every non-passing test from the most recent Playwright run.
 *
 * Usage:
 *   npm run analyze:failures                 # reads test-results/results.json
 *   npm run analyze:failures -- path/to.json # or an explicit path
 *
 * Prints a one-line summary (classification + healability verdict) per
 * failure and writes a full evidence artifact to
 * artifacts/healing/analysis-<timestamp>.json. This is a read-only
 * reporting step — it does not modify tests or source, and a "healable"
 * verdict here is only a *guardrail decision* (Step 29), not an action:
 * generating an actual patch and re-running the test is a separate,
 * later step ("Step 30") that does not exist yet.
 */

import * as fs from 'fs';
import * as path from 'path';
import { analyze } from './FailureAnalyzer';
import { decideHealability } from './HealerAgent';
import { loadLatestFailures } from './buildFailureInput';

const DEFAULT_RESULTS_PATH = path.resolve(process.cwd(), 'test-results/results.json');
const ARTIFACTS_DIR = path.resolve(process.cwd(), 'artifacts/healing');

function main(): void {
  const resultsPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_RESULTS_PATH;

  if (!fs.existsSync(resultsPath)) {
    console.error(
      `[analyze-failures] No results file at ${resultsPath}. Run tests with the 'json' reporter first (npx playwright test), then re-run this command.`
    );
    process.exitCode = 1;
    return;
  }

  const failures = loadLatestFailures(resultsPath);

  if (failures.length === 0) {
    console.log('[analyze-failures] No failing tests found in the latest run — nothing to classify.');
    return;
  }

  const analyzed = failures.map((input) => {
    const classification = analyze(input);
    return { input, classification, healability: decideHealability(classification) };
  });

  console.log(`[analyze-failures] ${analyzed.length} failing test(s) classified:\n`);
  for (const { input, classification, healability } of analyzed) {
    const verdict = healability.healable ? 'HEALABLE' : 'NOT HEALABLE';
    console.log(
      `  [${classification.category}] (confidence ${classification.confidence.toFixed(2)}) ${input.testTitle}\n` +
        `      ${classification.reasoning}\n` +
        `      -> ${verdict}: ${healability.reason}\n`
    );
  }

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const outputPath = path.join(ARTIFACTS_DIR, `analysis-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(analyzed, null, 2));
  console.log(`[analyze-failures] Full evidence written to ${outputPath}`);
}

main();
