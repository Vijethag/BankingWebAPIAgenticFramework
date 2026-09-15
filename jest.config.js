/**
 * Jest is scoped to pure unit tests only (utils, schema validators,
 * agent-logic helpers). UI/API specs run under Playwright Test, not Jest.
 *
 * Transform uses @swc/jest instead of ts-jest: it's a transpile-only
 * transform (no TypeScript compiler API involved), so it stays decoupled
 * from whichever `typescript` version the rest of the repo uses. Type
 * safety for this codebase is enforced separately via `tsc --noEmit`.
 *
 * Plain CommonJS file on purpose: Jest has to load this config before any
 * transform exists, so a .ts config risks its own loader chicken-and-egg
 * problem.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
  testMatch: ['**/tests/unit/**/*.test.ts', '**/src/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/ui/', '/tests/api/'],
  clearMocks: true,
};
