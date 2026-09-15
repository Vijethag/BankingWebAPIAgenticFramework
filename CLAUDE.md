# ParaBank Automation Framework

Stack:
- TypeScript
- Playwright
- Zod
- GitHub Actions

Architecture:
- pages = UI abstraction
- api/clients = REST abstraction
- fixtures = dependency injection
- factories = generated test data
- tests/ui = UI
- tests/api = API
- tests/e2e = cross-layer
- agents = AI functionality

Rules:
1. Never place selectors directly in tests.
2. Never hard-code environment URLs.
3. Never use real PII.
4. Never repair product assertions automatically.
5. Run TypeScript validation after changes.
6. Run affected tests after modifications.