# Feature: Transfer Funds (ParaBank)

E2E flow: **API setup** (provision isolated customer + 2 accounts) → **UI action** (submit
Transfer Funds form) → **API verification** (assert balances/transactions via REST).

Target: self-hosted `parasoft/parabank` Docker image (`docker run -d --name parabank
-p 8080:8080 parasoft/parabank`). The shared public demo (parabank.parasoft.com) was
abandoned as a target after live exploration showed it in a progressively degrading state
(login, Accounts Overview, and Transfer Funds all intermittently 500ing). Self-hosting gives
a deterministic target with a fresh, uncorrupted DB per container run.

**Gotcha for CI/first-boot**: the DB seeds lazily — the first request to `index.htm` gets a
302 to `initializeDB.htm`, and the seeded data (including the `john`/`demo` user this whole
spec depends on) only exists after that redirect is actually followed. A bare
health-check `curl` without `-L` (or a HEAD request) leaves the DB uninitialized. Any CI setup
step should `curl -L` (or otherwise follow redirects) against `index.htm`, or call
`POST /initializeDB` directly, before running tests.

All scenarios below were driven live against the self-hosted instance via `playwright-cli`
and cross-checked with the REST API — nothing here is guessed.

## Setup — known-app-bug detour: registration abandoned in favor of the seeded user
The original plan was to register a fresh, isolated customer per worker (via `register.htm`,
then `POST /createAccount` for a 2nd account), so no scenario would ever share account state.
Live exploration disproved that this is currently possible:

**Confirmed reproducible bug, root-caused in the app's own source** (parasoft/parabank on
GitHub): `register.htm` rejects *every* submission with "This username already exists in
database" — including cryptographically-random UUID usernames, on a container recreated from
scratch seconds earlier with zero prior registrations. Reproduced 4 separate ways (browser via
`playwright-cli`, raw `curl` POST, repeated full container recreation, and after an explicit
`POST /cleanDB` + `POST /initializeDB` reset) — ruling out stale state, timing/warm-up, and
container-specific corruption.

Root cause, from `RegisterCustomerController.onSubmit()`:
```java
try {
    bankManager.createCustomer(customerForm.getCustomer());
} catch (final DataIntegrityViolationException ex) {
    log.warn("Username " + customerForm.getCustomer().getUsername() + " already exists in database");
    errors.rejectValue("customer.username", "error.username.already.exists");
    ...
}
```
This blames **any** `DataIntegrityViolationException` on the username, unconditionally — it
never inspects which column/constraint actually failed. The real insert
(`JdbcCustomerDao.createCustomer`) assigns the new row's primary key from a hand-rolled
sequence table (`JdbcSequenceDao.getNextId`: read `next_id`, then `UPDATE ... SET next_id =
next_id + 111` in a separate statement, no explicit transaction/locking). The most likely
failure is a primary-key collision from that sequence advancing incorrectly — but the
exception is swallowed before any SQL-level detail is logged, so this couldn't be confirmed to
the exact line without patching/rebuilding the app, which is out of scope here. Either way,
the misleading "username already exists" message is a genuine, unconditional defect in the
app itself, not our environment. (It likely also explains part of why the public shared
demo's registration was misbehaving during earlier exploration — same source code.)

**Fallback**: every fresh ParaBank database seeds one seeded customer,
`john`/`demo` (id 12212), with 11 existing accounts (mix of CHECKING/SAVINGS). Each of the 6
scenarios below is assigned its own fixed, non-overlapping pair of those 11 accounts (see
`TRANSFER_ACCOUNTS` in `src/fixtures/base.ts`), so scenarios stay safe to run fully in
parallel (`fullyParallel: true`) despite sharing one customer — no two scenarios ever touch
the same account. Each test still logs in independently via `LoginPage`.

## Verified page structure — `transfer.htm`
- Amount input: `#amount` (no name/label — id is the only stable handle)
- From-account `<select>`: `#fromAccountId`
- To-account `<select>`: `#toAccountId`
- Submit: `<input type="submit">`, accessible name **"Transfer"**
- Success: `<h1>Transfer Complete!</h1>` + `<p>$X.XX has been transferred from account
  #A to account #B.</p>`
- Any non-numeric amount ⇒ app-wide generic error panel (`<h1>Error!</h1>` / "An internal
  error has occurred and has been logged."), i.e. an unhandled server exception, not a
  graceful validation message.

## Ledger semantics (verified via REST before/after balances + transaction lists)
For a submitted transfer of `amount` from account `F` to account `T`:
- `F.balance_after = F.balance_before - amount`
- `T.balance_after = T.balance_before + amount`
- `F` gets a new transaction: `{ type: "Debit", amount, description: "Funds Transfer Sent" }`
- `T` gets a new transaction: `{ type: "Credit", amount, description: "Funds Transfer Received" }`

This holds for **every** amount value ParaBank accepted during exploration — including
negative amounts, where it reverses the effective direction of money movement (see TF-05).
When `F === T` (same account), the two updates cancel out exactly, so the balance is
unchanged but two transaction records (one Debit, one Credit) are still written.

## Scenarios

| ID | Name | Verified real behavior |
|----|------|------------------------|
| TF-01 | Happy path transfer between own accounts | Succeeds. Exact confirmation copy. Both balances move by exactly `amount`, in opposite directions. One Debit + one Credit transaction created. |
| TF-02 | Transfer amount exceeds available balance | **No overdraft protection.** Succeeds anyway; source account balance goes negative by the shortfall. This documents real app behavior — not a bug to work around. |
| TF-03 | Transfer to the same account | Allowed. "Transfer Complete!" shown. Net balance change is $0 (paired Debit+Credit on the same account), but a transaction pair is still recorded. |
| TF-04 | Zero-amount transfer | Allowed. "Transfer Complete!" with `$0.00`. No functional balance change (asserted via API). |
| TF-05 | Negative-amount transfer | Allowed. "Transfer Complete!" with a `-$X.XX` message. Balance direction is reversed per the ledger formula above (dest loses money, source gains). |
| TF-06 | Non-numeric amount | Fails hard: generic `Error!` panel (HTTP 500 server-side exception), not an inline field validation message. |

All scenarios are independent (no ordering dependency) — each computes its own balance
baseline via the API immediately before acting, then asserts only the *delta*, so shared
worker-level account state across scenarios cannot cause flakiness.
