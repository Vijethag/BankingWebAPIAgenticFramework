/**
 * HealerAgent — strict guardrails deciding whether a *classified* failure is
 * safe to auto-heal.
 *
 * Scope (intentional, "Step 29" of the architecture plan): this module only
 * answers one yes/no question — is this failure healable? — and says why.
 * It does not:
 *   - generate a patch / diff ("Step 30" — separate follow-up)
 *   - touch git, the filesystem, or any test/source file
 *   - re-run tests or wire into CI ("Step 31" — separate follow-up)
 *
 * Flow (matches the architecture plan's diagram):
 *
 *   Failure -> FailureAnalyzer.analyze() -> FailureClassification
 *           -> HealerAgent.decideHealability() -> HealabilityVerdict
 *                YES -> (future) Healer patches + reruns
 *                NO  -> Fail, surface to a human with the evidence
 *
 * Why a hard category allowlist instead of "just trust confidence": the
 * whole point of this guardrail is that an AI must never "fix" a test
 * because the *application* has a real defect (see specs/login-concurrency.md
 * and specs/rest-api.md for two confirmed, real ParaBank defects this
 * project already found — an auto-healer must fail loudly on cases like
 * these, not quietly rewrite the test to stop noticing them). Locator/DOM
 * drift and minor flake are healable; behavior differences are never
 * "corrected" by editing the test.
 */

import type { FailureCategory, FailureClassification } from './FailureAnalyzer';

export interface HealabilityVerdict {
  healable: boolean;
  category: FailureCategory;
  /** The classification's own confidence, carried through for downstream logging/thresholds. */
  confidence: number;
  /** Human-readable explanation of the healable/not-healable call. */
  reason: string;
}

/**
 * Categories that describe purely mechanical drift — the test's *intent*
 * (what the assertion checks) is still valid, only *how to find/wait for*
 * something needs adjusting. Mirrors the plan's "Healable" list: locator
 * changed, accessible name changed, DOM structure changed, minor
 * synchronization problem.
 */
const HEALABLE_CATEGORIES: ReadonlySet<FailureCategory> = new Set(['LOCATOR_CHANGED', 'TIMING']);

/**
 * PRODUCT_BUG is not merely excluded by omission from HEALABLE_CATEGORIES —
 * it's explicitly, permanently blocked below regardless of confidence or any
 * future change to the set above. This is the one category FailureAnalyzer
 * emits specifically to say "the application misbehaved", and no confidence
 * threshold should ever be able to route that into auto-healing.
 */
const NEVER_HEALABLE_CATEGORIES: ReadonlySet<FailureCategory> = new Set(['PRODUCT_BUG']);

/**
 * Even a mechanically-healable category needs the classifier to have been
 * reasonably sure — a low-confidence LOCATOR_CHANGED guess is exactly the
 * kind of ambiguous case that should go to a human, not to auto-patching.
 * Chosen to sit just below FailureAnalyzer's TIMING confidence (0.55) and
 * comfortably below its LOCATOR_CHANGED confidence (0.9), so today's rules
 * land clearly on one side or the other rather than hugging the line.
 */
export const MIN_HEALABLE_CONFIDENCE = 0.6;

export function decideHealability(classification: FailureClassification): HealabilityVerdict {
  const { category, confidence } = classification;

  if (NEVER_HEALABLE_CATEGORIES.has(category)) {
    return {
      healable: false,
      category,
      confidence,
      reason: `${category} means the application itself misbehaved — never auto-healable, regardless of confidence. A human must review and decide whether this is a real product defect.`,
    };
  }

  if (!HEALABLE_CATEGORIES.has(category)) {
    return {
      healable: false,
      category,
      confidence,
      reason: `${category} is not in the healable set (${[...HEALABLE_CATEGORIES].join(', ')}) — it does not represent purely mechanical drift (locator/DOM/timing), so it needs human triage rather than automatic patching.`,
    };
  }

  if (confidence < MIN_HEALABLE_CONFIDENCE) {
    return {
      healable: false,
      category,
      confidence,
      reason: `${category} is a healable category in principle, but classification confidence (${confidence.toFixed(2)}) is below the minimum required for automatic healing (${MIN_HEALABLE_CONFIDENCE}) — too uncertain to act on without a human.`,
    };
  }

  return {
    healable: true,
    category,
    confidence,
    reason: `${category} with confidence ${confidence.toFixed(2)} is mechanical drift (locator/DOM/timing), not an application behavior change — safe to hand to the Healer for a candidate fix.`,
  };
}
