# Feature: Standalone REST API coverage (ParaBank `services/bank`)

Complements `transfer-funds.md` (API→UI→API flow) with direct, UI-independent coverage of
the REST layer itself — `tests/api/*.spec.ts`, run via `npm run test:api` (Playwright project
`api`, `testDir: tests/api`). Every endpoint/behavior below was hit live against the
self-hosted instance via `curl` before being encoded as a test — nothing here is guessed.

## Test isolation: a 2nd, more severe app bug in `POST /createAccount`

Every seeded account (all 11 belonging to `john`/`demo`, id 12212) is already claimed by a
fixed pair in `TRANSFER_ACCOUNTS` for the UI suite (see `transfer-funds.md`), so this suite
needs its own, separately-provisioned accounts. `POST /createAccount` (unlike `register.htm`)
works — reliably, *as long as calls are strictly sequential*.

**Confirmed reproducible concurrency bug**: firing just 4-5 concurrent `createAccount`
requests — even against **different, well-funded source accounts** (ruling out simple
per-account balance-check races) — causes most of them (observed 3/4, 3/5) to fail with
`"Could not create new account for customer X from account Y"` (HTTP 400), with no partial
side effects (the source account's balance is untouched on failure). This is the same
broad-exception-swallowing pattern as the `register.htm` bug documented in
`transfer-funds.md` — some shared, unsynchronized resource (most likely the same
`JdbcSequenceDao` pattern used for customer IDs) breaks under concurrent writes.

**Fix — provision serially, before workers go parallel**: `globalSetup.ts` runs once, single
threaded, before any test worker starts, and builds a full pool of `(checking, savings)`
account pairs — one pair per worker (`config.workers` pairs), one `createAccount` call at a
time, always awaited. The pool is written to `.generated/api-accounts-pool.json` (gitignored)
and the worker-scoped `apiAccounts` fixture (`src/fixtures/base.ts`) just reads its own slot
(`pool[workerInfo.workerIndex % pool.length]`) — no network calls, no race, at test time.
Verified stable across repeated full runs with default (5) parallel workers.

The very first pair in the pool is bootstrapped from `TRANSFER_ACCOUNTS.tf06NonNumeric.to`
(one one-time $100 debit); every subsequent pair chains its funding off the previous pair's
own savings account, so nothing beyond that single bootstrap debit ever touches a UI-suite
account. Run `test:ui` and `test:api` as separate commands (already the case — see
`package.json`) so even that one bootstrap debit can't race a UI assertion.

## `ApiHelper` hardening: `Content-Type` lies

Verified live: `POST /deposit`, `/withdraw`, and `/transfer` all declare
`Content-Type: application/json` on success, but the body is a raw, unquoted plain-text
string (e.g. `Successfully deposited $50 to account #12345`) — not valid JSON. A naive
`response.json()` throws a `SyntaxError` on these even though the call succeeded. `ApiHelper`
now always reads the body as text first and only `JSON.parse`s it opportunistically, falling
back to the raw text on failure — so every call resolves to `{ status, body }` uniformly,
whether the payload is real JSON, a mislabeled plain-text success message, or a genuine
`text/plain` error message.

## Endpoint behaviors verified

| Endpoint | Success | Error / edge case |
|---|---|---|
| `GET /login/{u}/{p}` | 200, `Customer` JSON | Wrong password or unknown user: 400, plain text `"Invalid username and/or password"` (same message either way — doesn't leak which part was wrong) |
| `GET /customers/{id}` | 200, `Customer` JSON | Unknown id: 400, `"Could not find customer #<id>"` |
| `GET /accounts/{id}` | 200, `Account` JSON | Unknown id: 400, `"Could not find account #<id>"` |
| `GET /customers/{id}/accounts` | 200, `Account[]` | — |
| `GET /accounts/{id}/transactions` | 200, `Transaction[]` | Unknown id: 400, `"Could not find transactions for account #<id>"` (differs in wording from the two below) |
| `POST /createAccount` | 200, new `Account` (`balance: 0` before funding lands), funded with exactly $100 debited from `fromAccountId` | Unknown `fromAccountId`: 400, `"Could not create new account for customer <cid> from account <fid>"`. **Must be called serially** — see concurrency bug above |
| `POST /deposit` | 200, mislabeled-JSON text `"Successfully deposited $<amt> to account #<id>"`; balance +`amt` | Unknown account: 400, `"Could not find account number <id>"` (note: *"number"*, not `#`) |
| `POST /withdraw` | 200, text `"Successfully withdrew $<amt> from account #<id>"`; balance −`amt`, **no overdraft protection** (succeeds even past available balance, consistent with the UI's Transfer Funds behavior) | Unknown account: 400, `"Could not find account number <id>"` |
| `POST /transfer` | 200, text `"Successfully transferred $<amt> from account #<from> to account #<to>"`; same no-overdraft/zero/negative/same-account leniency as the UI form (see `transfer-funds.md`) | Unknown account: 400, `"Could not find account number <from> and/or <to>"` (lists both ids regardless of which is actually invalid) |

## `POST /transfer` error-handling mechanics differ from the UI form

The UI form maps *any* malformed `amount` to the same generic `Error!` panel (HTTP 500). The
REST endpoint is inconsistent across failure modes instead of uniform:
- **Non-numeric `amount`** (e.g. `amount=abc`): HTTP **404**, empty body. This is a JAX-RS
  parameter-binding failure — the request never reaches the resource method at all, so it's
  treated as "no matching route" rather than a client or server error.
- **Missing required `amount`**: HTTP **500**, and the body is a full HTML page — literally
  the *UI's* generic error template (`<h1>Error!</h1>` / "An internal error has occurred and
  has been logged."), reused verbatim for what should be a clean REST error response.

Both are asserted explicitly in `tests/api/transfer.spec.ts` rather than treated as
flakiness or worked around — they're real, reproducible API-design inconsistencies.
