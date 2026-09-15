import { applyLocatorPatch, runAffectedTestSync } from '../../src/agents/healer/PatchGenerator';
import type { LocatorFixProposal } from '../../src/agents/healer/proposeLocatorFix';

const SOURCE_FIXTURE = [
  "import { Locator, Page } from '@playwright/test';",
  '',
  'export class LoginPage {',
  '  readonly usernameInput: Locator;',
  '',
  '  constructor(page: Page) {',
  '    this.usernameInput = page.locator(\'input[name="user name"]\');',
  "    this.passwordInput = page.locator('input[name=\"password\"]');",
  '  }',
  '}',
  '',
].join('\n');

function proposal(overrides: Partial<LocatorFixProposal> = {}): LocatorFixProposal {
  return {
    newLocatorExpression: 'page.locator(\'input[name="username"]\')',
    rationale: 'The real attribute is "username", not "user name".',
    confidence: 0.9,
    ...overrides,
  };
}

/** In-memory fake filesystem so these tests never touch disk. */
function fakeFs(initial: Record<string, string>) {
  const files = { ...initial };
  return {
    files,
    readFile: (path: string) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
      return files[path];
    },
    writeFile: (path: string, content: string) => {
      files[path] = content;
    },
  };
}

describe('applyLocatorPatch', () => {
  it('applies the proposal and keeps it when verify() passes (real incident shape: LoginPage typo)', async () => {
    const fs = fakeFs({ '/repo/src/pages/LoginPage.ts': SOURCE_FIXTURE });

    const result = await applyLocatorPatch({
      filePath: '/repo/src/pages/LoginPage.ts',
      brokenLocatorLiteral: 'input[name="user name"]',
      proposal: proposal(),
      verify: async () => true,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
    });

    expect(result.applied).toBe(true);
    expect(result.oldExpression).toBe('page.locator(\'input[name="user name"]\')');
    expect(result.newExpression).toBe('page.locator(\'input[name="username"]\')');
    expect(fs.files['/repo/src/pages/LoginPage.ts']).toContain('page.locator(\'input[name="username"]\')');
    expect(fs.files['/repo/src/pages/LoginPage.ts']).not.toContain('user name');
    // The sibling passwordInput line must be untouched.
    expect(fs.files['/repo/src/pages/LoginPage.ts']).toContain('page.locator(\'input[name="password"]\')');
  });

  it('reverts the file byte-for-byte when verify() returns false', async () => {
    const fs = fakeFs({ '/repo/src/pages/LoginPage.ts': SOURCE_FIXTURE });

    const result = await applyLocatorPatch({
      filePath: '/repo/src/pages/LoginPage.ts',
      brokenLocatorLiteral: 'input[name="user name"]',
      proposal: proposal(),
      verify: async () => false,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('still did not pass');
    expect(fs.files['/repo/src/pages/LoginPage.ts']).toBe(SOURCE_FIXTURE);
  });

  it('reverts the file when verify() throws instead of resolving', async () => {
    const fs = fakeFs({ '/repo/src/pages/LoginPage.ts': SOURCE_FIXTURE });

    const result = await applyLocatorPatch({
      filePath: '/repo/src/pages/LoginPage.ts',
      brokenLocatorLiteral: 'input[name="user name"]',
      proposal: proposal(),
      verify: async () => {
        throw new Error('browser crashed');
      },
      readFile: fs.readFile,
      writeFile: fs.writeFile,
    });

    expect(result.applied).toBe(false);
    expect(fs.files['/repo/src/pages/LoginPage.ts']).toBe(SOURCE_FIXTURE);
  });

  it('rejects a proposal that is not a well-formed "page." expression, without touching the file', async () => {
    const fs = fakeFs({ '/repo/src/pages/LoginPage.ts': SOURCE_FIXTURE });
    const verify = jest.fn(async () => true);

    const result = await applyLocatorPatch({
      filePath: '/repo/src/pages/LoginPage.ts',
      brokenLocatorLiteral: 'input[name="user name"]',
      proposal: proposal({ newLocatorExpression: 'document.querySelector("input")' }),
      verify,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('Rejected');
    expect(verify).not.toHaveBeenCalled();
    expect(fs.files['/repo/src/pages/LoginPage.ts']).toBe(SOURCE_FIXTURE);
  });

  it('reports failure cleanly when the broken locator literal is not found in the file', async () => {
    const fs = fakeFs({ '/repo/src/pages/LoginPage.ts': SOURCE_FIXTURE });

    const result = await applyLocatorPatch({
      filePath: '/repo/src/pages/LoginPage.ts',
      brokenLocatorLiteral: 'input[name="does not exist"]',
      proposal: proposal(),
      verify: async () => true,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('reports failure cleanly when the line has the literal but no isolatable "page.<method>(...)" call', async () => {
    const fs = fakeFs({
      '/repo/src/pages/Weird.ts': "const label = 'input[name=\"user name\"]'; // just a comment, not a locator call\n",
    });

    const result = await applyLocatorPatch({
      filePath: '/repo/src/pages/Weird.ts',
      brokenLocatorLiteral: 'input[name="user name"]',
      proposal: proposal(),
      verify: async () => true,
      readFile: fs.readFile,
      writeFile: fs.writeFile,
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toContain("couldn't isolate");
  });
});

describe('runAffectedTestSync', () => {
  it('returns false (never throws) when the test run fails to even start', () => {
    expect(() => runAffectedTestSync('tests/ui/does-not-exist.spec.ts', 'nonexistent test', 'ui-chromium')).not.toThrow();
    expect(runAffectedTestSync('tests/ui/does-not-exist.spec.ts', 'nonexistent test', 'ui-chromium')).toBe(false);
  }, 30_000);
});
