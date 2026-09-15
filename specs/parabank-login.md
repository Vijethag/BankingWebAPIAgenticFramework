# ParaBank Login Test Plan

Target: self-hosted ParaBank at `http://localhost:8080/parabank/` (see `config/.env` /
`specs/transfer-funds.md` for why self-hosted is used instead of the public demo).

All scenarios below were driven live via `playwright-cli` against this instance. Nothing here
is guessed — every element, message, and status was observed directly.

**General precondition (applies to every scenario):** `GET /parabank/login.htm` directly
returns **HTTP 400** (`Required parameter 'username' is not present.`) — it's the form's
POST-handling endpoint, not a page. The actual Customer Login form lives on
`GET /parabank/index.htm` (heading "Customer Login", level 2). Every scenario below starts by
navigating to `index.htm`, not `login.htm`.

**General observation (applies to every negative scenario, 1.2–1.5):** validation is
**server-side**, not client-side. Each failed submission does a full page navigation back to
`http://localhost:8080/parabank/login.htm` (page title "ParaBank | Error"), renders a generic
`<h1>Error!</h1>` heading with a specific message paragraph, and **both the Username and
Password fields are empty afterward** — no submitted values are retained.

## 1. Login Flow

### 1.1 Valid Registered User

**Preconditions**
- ParaBank self-hosted instance is running and its database has been initialized (first
  request to `index.htm` triggers lazy DB seeding — see `specs/transfer-funds.md`).
- The seeded test user `SEEDED_USER` (`username: 'john'`, `password: 'demo'`, customer id
  12212) already exists in the seeded database — confirmed live, no registration needed.
- Browser is on a fresh, unauthenticated `index.htm` (Customer Login form visible, no prior
  session).

**Test Data**
- Username: `john`
- Password: `demo`

**Steps**
1. Navigate to `http://localhost:8080/parabank/index.htm`.
2. Enter `john` into the Username field.
3. Enter `demo` into the Password field.
4. Click the "Log In" button.

**Expected Assertions**
- Browser navigates away from the login page to `http://localhost:8080/parabank/overview.htm`.
- Page title is exactly `ParaBank | Accounts Overview`.
- A level-1 heading "Accounts Overview" is visible.
- A paragraph "Welcome John Smith" is visible (confirms the authenticated identity).
- A "Log Out" link is visible — its presence is the stable signal that the session is
  authenticated (it does not exist anywhere on the logged-out login page).
- An accounts table is visible with column headers "Account", "Balance*", "Available
  Amount", listing one row per account owned by the customer plus a "Total" row.
- (Cleanup, not a scenario assertion) Clicking "Log Out" returns to the logged-out welcome
  page at `index.htm` without error, ending the authenticated session.

---

### 1.2 Empty Username

**Preconditions**
- Browser is on a fresh, unauthenticated `index.htm` (no session, empty Username/Password
  fields).

**Test Data**
- Username: *(empty)*
- Password: `demo`

**Steps**
1. Navigate to `http://localhost:8080/parabank/index.htm`.
2. Leave the Username field empty.
3. Enter `demo` into the Password field.
4. Click the "Log In" button.

**Expected Assertions**
- Page navigates to `http://localhost:8080/parabank/login.htm`, page title `ParaBank | Error`.
- A level-1 heading "Error!" is visible.
- The paragraph "Please enter a username and password." is visible (server-side validation).
- After the reload, both the Username and the Password fields are empty (the previously
  entered password is not retained).
- The user remains unauthenticated: the "Customer Login" heading is present again, and there
  is no "Log Out" link or "Accounts Overview" content anywhere on the page.

---

### 1.3 Empty Password

**Preconditions**
- Browser is on a fresh, unauthenticated `index.htm` (no session, empty Username/Password
  fields).

**Test Data**
- Username: `john`
- Password: *(empty)*

**Steps**
1. Navigate to `http://localhost:8080/parabank/index.htm`.
2. Enter `john` into the Username field.
3. Leave the Password field empty.
4. Click the "Log In" button.

**Expected Assertions**
- Page navigates to `http://localhost:8080/parabank/login.htm`, page title `ParaBank | Error`.
- A level-1 heading "Error!" is visible.
- The paragraph "Please enter a username and password." is visible — **identical wording to
  Scenario 1.2**; the app does not distinguish which field was missing.
- After the reload, both the Username and the Password fields are empty.
- The user remains unauthenticated (same evidence as 1.2: "Customer Login" heading present,
  no "Log Out" link, no Accounts Overview content).

---

### 1.4 Empty Username and Password

**Preconditions**
- Browser is on a fresh, unauthenticated `index.htm` (no session, empty Username/Password
  fields).

**Test Data**
- Username: *(empty)*
- Password: *(empty)*

**Steps**
1. Navigate to `http://localhost:8080/parabank/index.htm`.
2. Leave both the Username and Password fields empty.
3. Click the "Log In" button.

**Expected Assertions**
- Page navigates to `http://localhost:8080/parabank/login.htm`, page title `ParaBank | Error`.
- A level-1 heading "Error!" is visible.
- The paragraph "Please enter a username and password." is visible — **identical wording to
  Scenarios 1.2 and 1.3**.
- After the reload, both the Username and the Password fields are empty.
- The user remains unauthenticated (same evidence as 1.2/1.3).

---

### 1.5 Invalid Credentials

**Preconditions**
- Browser is on a fresh, unauthenticated `index.htm` (no session, empty Username/Password
  fields).
- The credentials used do not correspond to any real account (`foo`/`bar` — confirmed not a
  valid seeded user).

**Test Data**
- Username: `foo`
- Password: `bar`

**Steps**
1. Navigate to `http://localhost:8080/parabank/index.htm`.
2. Enter `foo` into the Username field.
3. Enter `bar` into the Password field.
4. Click the "Log In" button.

**Expected Assertions**
- Page navigates to `http://localhost:8080/parabank/login.htm`, page title `ParaBank | Error`.
- A level-1 heading "Error!" is visible.
- The paragraph "The username and password could not be verified." is visible — **distinct
  wording from the empty-field scenarios (1.2–1.4)**, confirming the app differentiates
  "missing input" from "credentials don't match an account" server-side.
- After the reload, both the Username and the Password fields are empty.
- The user remains unauthenticated: current URL is `http://localhost:8080/parabank/login.htm`
  (never reaches `overview.htm`), "Customer Login" heading is present again, no "Log Out"
  link or Accounts Overview content is present.
