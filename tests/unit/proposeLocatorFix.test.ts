import { proposeLocatorFix } from '../../src/agents/healer/proposeLocatorFix';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

function textResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const BASE_INPUT = {
  brokenLocatorLiteral: 'input[name="user name"]',
  errorMessage: 'Error: locator.fill: Test timeout of 30000ms exceeded.',
  domHtml: '<html><body><input type="text" name="username" /></body></html>',
};

describe('proposeLocatorFix', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it('throws a clear error when ANTHROPIC_API_KEY is not set (operational failure, not a "no match" case)', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(proposeLocatorFix(BASE_INPUT)).rejects.toThrow('ANTHROPIC_API_KEY is not set');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('parses a well-formed JSON proposal', async () => {
    mockCreate.mockResolvedValue(
      textResponse(
        JSON.stringify({
          newLocatorExpression: 'page.locator(\'input[name="username"]\')',
          rationale: 'The real attribute value is "username".',
          confidence: 0.92,
        })
      )
    );

    const result = await proposeLocatorFix(BASE_INPUT);

    expect(result).toEqual({
      newLocatorExpression: 'page.locator(\'input[name="username"]\')',
      rationale: 'The real attribute value is "username".',
      confidence: 0.92,
    });
  });

  it('strips ```json fences if the model wraps its output despite instructions not to', async () => {
    mockCreate.mockResolvedValue(
      textResponse(
        '```json\n' +
          JSON.stringify({ newLocatorExpression: 'page.getByLabel(\'Username\')', rationale: 'r', confidence: 0.7 }) +
          '\n```'
      )
    );

    const result = await proposeLocatorFix(BASE_INPUT);

    expect(result?.newLocatorExpression).toBe("page.getByLabel('Username')");
  });

  it('returns null for unparseable (non-JSON) model output', async () => {
    mockCreate.mockResolvedValue(textResponse('Sorry, I cannot help with that.'));

    const result = await proposeLocatorFix(BASE_INPUT);

    expect(result).toBeNull();
  });

  it('returns null when newLocatorExpression does not start with "page." (rejected as unsafe/malformed)', async () => {
    mockCreate.mockResolvedValue(
      textResponse(JSON.stringify({ newLocatorExpression: 'document.querySelector("input")', rationale: 'r', confidence: 0.5 }))
    );

    const result = await proposeLocatorFix(BASE_INPUT);

    expect(result).toBeNull();
  });

  it('returns null when the model reports it found no plausible match (empty newLocatorExpression)', async () => {
    mockCreate.mockResolvedValue(
      textResponse(JSON.stringify({ newLocatorExpression: '', rationale: 'No matching element found.', confidence: 0 }))
    );

    const result = await proposeLocatorFix(BASE_INPUT);

    expect(result).toBeNull();
  });

  it('returns null when there is no text content block at all', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'tool_use' }] });

    const result = await proposeLocatorFix(BASE_INPUT);

    expect(result).toBeNull();
  });

  it('sends the broken locator and DOM HTML in the user message, and a JSON-only instruction in the system prompt', async () => {
    mockCreate.mockResolvedValue(
      textResponse(JSON.stringify({ newLocatorExpression: 'page.locator(\'x\')', rationale: 'r', confidence: 0.5 }))
    );

    await proposeLocatorFix(BASE_INPUT);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.system).toContain('JSON');
    expect(call.messages[0].content).toContain(BASE_INPUT.brokenLocatorLiteral);
    expect(call.messages[0].content).toContain('username');
  });

  it('truncates very large DOM HTML rather than sending it in full', async () => {
    mockCreate.mockResolvedValue(
      textResponse(JSON.stringify({ newLocatorExpression: 'page.locator(\'x\')', rationale: 'r', confidence: 0.5 }))
    );

    const hugeHtml = '<div>'.repeat(10_000);
    await proposeLocatorFix({ ...BASE_INPUT, domHtml: hugeHtml });

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toContain('<!-- truncated -->');
    expect(call.messages[0].content.length).toBeLessThan(hugeHtml.length);
  });
});
