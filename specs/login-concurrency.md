# Discovered defect: login authentication race condition under concurrent load

**Status:** confirmed, reproducible, application-level (not a test/automation issue).

## Summary

`POST /parabank/login.htm` is not safe under concurrent requests: when many login
attempts hit the self-hosted ParaBank server at the same time, some requests receive
**another concurrent request's result** instead of their own. Observed in both directions:

- Valid credentials (`john`/`demo`) occasionally rejected with "The username and password
  could not be verified." (should succeed).
- Invalid credentials (`foo`/`bar`) occasionally succeed with an `HTTP 302` redirect to
  `overview.htm` (should be rejected).

This is the same class of bug already documented in `specs/rest-api.md` for
`POST /createAccount` — the app appears to use non-thread-safe, likely
instance-shared/static state somewhere in its authentication path instead of properly
scoping per-request data.

## How it was found

While implementing `tests/ui/login.spec.ts` (scenario 1.5, invalid-credentials `foo`/`bar`)
per `specs/parabank-login.md`, the test intermittently failed — `page` ended up on
`overview.htm` (an authenticated session) instead of the expected `login.htm` error page.
The test itself was correct; it only failed when run in parallel with the rest of the UI
suite (5 workers hitting the same server simultaneously). Running `tests/ui/login.spec.ts`
alone, repeated 15x, never failed — isolating the trigger to *concurrent* server load, not
the test logic.

## Reproduction (bypasses Playwright/browser entirely — confirms it's server-side)

Fired 40 concurrent `curl` `POST /parabank/login.htm` requests with valid credentials
interleaved with 40 concurrent requests with invalid credentials (separate processes, no
shared cookie jar):

```bash
for i in $(seq 1 40); do
  ( curl -s -o "valid_$i.html" -w "%{http_code}" -X POST "http://localhost:8080/parabank/login.htm" \
      --data-urlencode "username=john" --data-urlencode "password=demo" > "valid_$i.status" & )
  ( curl -s -o "bad_$i.html"   -w "%{http_code}" -X POST "http://localhost:8080/parabank/login.htm" \
      --data-urlencode "username=foo"  --data-urlencode "password=bar"  > "bad_$i.status" & )
done
wait
```

Result (one representative run): **5 of the 40** `foo`/`bar` requests came back `302`
(the app's own success/redirect status — failures render the error page directly with
`200`). A separate run also produced a `john`/`demo` request that came back `200` with body
`The username and password could not be verified.` — i.e. the two failure modes swap.

## Impact on the test suite

- `tests/ui/login.spec.ts` scenario **1.5** can intermittently fail when the full `ui-chromium`
  project runs in parallel (`fullyParallel: true`, unlimited local workers), because the login
  endpoint itself is racy under load — not because of a locator, assertion, or fixture bug.
- Per instructions, the test was **not** weakened, retried-around, or rewritten to hide this —
  the assertions match `specs/parabank-login.md` exactly. This is a real, disclosed app defect,
  not a test defect.
- If this proves too flaky for CI, the fix belongs in the *application* (thread-safety in the
  login path), not in loosening the test's assertions. A worthwhile follow-up would be to file
  this alongside the `createAccount` concurrency bug as a known ParaBank server issue.
