/**
 * The one and only LLM boundary in this whole Healer pipeline. Everything
 * else (FailureAnalyzer's classification, HealerAgent's healable/not
 * decision, PatchGenerator's apply/verify/revert) is deterministic and has
 * no network dependency, by design (see those files' own doc comments).
 *
 * Why an LLM is needed *here* specifically: FailureAnalyzer can prove a
 * locator never resolved (LOCATOR_CHANGED), and the DOM captured on failure
 * (src/fixtures/base.ts's `page` override) has the real, current markup —
 * but *picking* the right replacement locator out of a full page of HTML is
 * exactly the kind of fuzzy, semantic matching a deterministic regex can't
 * safely do (this project deliberately did not ship a heuristic string-
 * similarity guesser instead, at the user's request, in favor of a real LLM
 * call here). The LLM's job is narrow and single-purpose: given the broken
 * locator + the live DOM, propose ONE concrete replacement Playwright
 * locator expression. It never touches files, git, or test execution —
 * PatchGenerator.applyLocatorPatch does that, and always re-runs the
 * affected test to verify before keeping the change (see that file).
 */

import Anthropic from '@anthropic-ai/sdk';

export interface LocatorFixProposal {
  /** A full Playwright locator expression, e.g. `page.locator('input[name="username"]')` — always starts with "page.". */
  newLocatorExpression: string;
  /** Short explanation of why this element was chosen. */
  rationale: string;
  /** The model's own self-reported confidence, 0-1. */
  confidence: number;
}

export interface ProposeLocatorFixInput {
  /** The exact broken locator string extracted by FailureAnalyzer (e.g. `input[name="user name"]`). */
  brokenLocatorLiteral: string;
  errorMessage: string;
  /** Raw page.content() HTML captured at the moment of failure. */
  domHtml: string;
  testSource?: string;
}

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

/** Keeps the prompt (and cost/latency) bounded — full pages can be very large; the relevant markup is almost always near the top/body. */
const MAX_DOM_CHARS = 12_000;

const SYSTEM_PROMPT = `You are a narrow Playwright locator-repair assistant.

You will be given:
- a broken CSS/attribute locator string that no longer matches anything on the page
- the error message from the failed Playwright action
- the full, real HTML of the page at the moment of failure

Your only job: find the ONE element in the HTML that the broken locator was almost certainly trying to target, and propose a corrected Playwright locator expression for it.

Rules:
- Respond with ONLY a single JSON object — no prose, no markdown code fences, nothing else.
- The JSON object must have exactly these keys: "newLocatorExpression" (string), "rationale" (string), "confidence" (number between 0 and 1).
- "newLocatorExpression" MUST be a complete, syntactically valid Playwright locator expression starting with "page." (e.g. page.locator('input[name="username"]'), page.getByRole('button', { name: 'Log In' }), page.getByLabel('Username')).
- Prefer the same locator strategy the broken one used (e.g. an attribute selector) unless the HTML clearly has no matching attribute at all and a role/label/text-based locator is unambiguous.
- If you cannot find a plausible match at all, return {"newLocatorExpression": "", "rationale": "<why>", "confidence": 0}.`;

function buildUserMessage(input: ProposeLocatorFixInput): string {
  const truncatedHtml =
    input.domHtml.length > MAX_DOM_CHARS ? `${input.domHtml.slice(0, MAX_DOM_CHARS)}\n<!-- truncated -->` : input.domHtml;

  return [
    `Broken locator: ${input.brokenLocatorLiteral}`,
    '',
    `Error message:`,
    input.errorMessage,
    input.testSource ? `\nTest source (failing line marked with "> "):\n${input.testSource}` : '',
    '',
    'Page HTML at time of failure:',
    truncatedHtml,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Strips ```json ... ``` fences if the model wraps its JSON despite instructions not to. */
function extractJsonPayload(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

function parseProposal(text: string): LocatorFixProposal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(text));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.newLocatorExpression !== 'string' || !candidate.newLocatorExpression.startsWith('page.')) {
    return null;
  }

  return {
    newLocatorExpression: candidate.newLocatorExpression,
    rationale: typeof candidate.rationale === 'string' ? candidate.rationale : '',
    confidence: typeof candidate.confidence === 'number' ? candidate.confidence : 0,
  };
}

/**
 * Calls Claude to propose a replacement locator. Returns `null` (never
 * throws for a "no good answer" case) when the model couldn't find a
 * plausible match or returned something unparseable/unsafe — the caller
 * (healFailures.ts) treats that exactly like "could not heal automatically".
 *
 * Throws only for real operational failures (missing API key, network/API
 * error) so those are visibly distinct from "the model tried and failed".
 */
export async function proposeLocatorFix(input: ProposeLocatorFixInput): Promise<LocatorFixProposal | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set — required for LLM-assisted locator healing. Set it in config/.env locally, or as a GitHub Actions secret in CI.'
    );
  }

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  });

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
  if (!textBlock) return null;

  const proposal = parseProposal(textBlock.text);
  if (!proposal || !proposal.newLocatorExpression) return null;

  return proposal;
}
