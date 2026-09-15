import { decideHealability, MIN_HEALABLE_CONFIDENCE } from '../../src/agents/healer/HealerAgent';
import { analyze, FailureClassification } from '../../src/agents/healer/FailureAnalyzer';

function classification(overrides: Partial<FailureClassification>): FailureClassification {
  return {
    category: 'UNKNOWN',
    confidence: 0,
    reasoning: '',
    evidence: [],
    ...overrides,
  };
}

describe('decideHealability', () => {
  it('marks a high-confidence LOCATOR_CHANGED as healable', () => {
    const verdict = decideHealability(classification({ category: 'LOCATOR_CHANGED', confidence: 0.9 }));

    expect(verdict.healable).toBe(true);
    expect(verdict.category).toBe('LOCATOR_CHANGED');
  });

  it('marks a high-confidence TIMING (minor synchronization problem) as healable', () => {
    const verdict = decideHealability(classification({ category: 'TIMING', confidence: 0.75 }));

    expect(verdict.healable).toBe(true);
  });

  it('rejects TIMING at the FailureAnalyzer\'s current default confidence (0.55) — below MIN_HEALABLE_CONFIDENCE by design', () => {
    // Documents an intentional gap: TIMING is *in principle* healable, but
    // today's bare-timeout heuristic in FailureAnalyzer only ever emits 0.55
    // for it, which this guardrail correctly refuses to act on automatically.
    const verdict = decideHealability(classification({ category: 'TIMING', confidence: 0.55 }));

    expect(verdict.healable).toBe(false);
    expect(verdict.reason).toContain('confidence');
  });

  it('rejects a low-confidence LOCATOR_CHANGED even though the category is healable in principle', () => {
    const verdict = decideHealability(classification({ category: 'LOCATOR_CHANGED', confidence: 0.3 }));

    expect(verdict.healable).toBe(false);
    expect(verdict.reason).toContain(String(MIN_HEALABLE_CONFIDENCE));
  });

  it.each([
    ['NETWORK', 0.9],
    ['ENVIRONMENT', 0.95],
    ['ASSERTION', 0.6],
    ['UNKNOWN', 0],
  ] as const)('rejects %s regardless of confidence (%s) — not a mechanical-drift category', (category, confidence) => {
    const verdict = decideHealability(classification({ category, confidence }));

    expect(verdict.healable).toBe(false);
  });

  it('always hard-blocks PRODUCT_BUG, even at very high confidence — the core guardrail this module exists for', () => {
    const verdict = decideHealability(classification({ category: 'PRODUCT_BUG', confidence: 0.99 }));

    expect(verdict.healable).toBe(false);
    expect(verdict.reason).toContain('never auto-healable');
  });

  it('is deterministic: identical classification input always yields an identical verdict', () => {
    const input = classification({ category: 'LOCATOR_CHANGED', confidence: 0.9 });

    expect(decideHealability(input)).toEqual(decideHealability(input));
  });

  describe('composed with the real FailureAnalyzer (end-to-end sanity on this project\'s own grounded fixtures)', () => {
    it('flags the real LoginPage locator typo incident as healable', () => {
      const failureClassification = analyze({
        testTitle: '1.1 Valid registered user can login',
        testFile: 'tests/ui/login.spec.ts',
        errorMessage: [
          'Error: locator.fill: Test timeout of 30000ms exceeded.',
          'Call log:',
          '  - waiting for locator(\'input[name="user name"]\')',
        ].join('\n'),
      });

      const verdict = decideHealability(failureClassification);

      expect(verdict.healable).toBe(true);
    });

    it('never flags the real login-concurrency race (specs/login-concurrency.md) as healable', () => {
      const failureClassification = analyze({
        testTitle: '1.5 Invalid credentials show authentication error',
        testFile: 'tests/ui/login.spec.ts',
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
      });

      expect(failureClassification.category).toBe('PRODUCT_BUG');
      const verdict = decideHealability(failureClassification);

      expect(verdict.healable).toBe(false);
    });
  });
});
