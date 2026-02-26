# Rules Reference

Complete catalog of all audit rules implemented in Scantrix v5.2.0.

---

## Flakiness Rules (PW-FLAKE-*)

### PW-FLAKE-001 — Hard waits or debug pauses detected
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `waitForTimeout`, `setTimeout`, promise-based sleep helpers, `page.pause()` |
| File Globs | `**/*.spec.*`, `**/*.test.*`, `**/POMs/**/*.ts`, `**/pages/**/*.ts`, `**/fixtures/**/*.ts` |

Hard waits slow tests and hide timing bugs. `page.pause()` is a debug-only method that halts execution and opens the Playwright Inspector — it must be removed before committing.

> **Test content gate:** Files without test framework DSL (no `test()`, `it()`, `describe()`, or page object patterns) are automatically excluded, even when matched by directory globs like `**/fixtures/**`.

### PW-FLAKE-002 — Force-click usage detected
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Flakiness |
| Patterns | `{ force: true }` |
| Scope | Playwright-only |

Force clicks bypass Playwright's actionability checks. While there are legitimate uses (e.g., clicking outside a modal to close it, testing dismiss-on-overlay-click), widespread usage may hide real UI issues.

> **Test content gate:** Files without test framework DSL (no `test()`, `it()`, `describe()`, or page object patterns) are automatically excluded, even when matched by directory globs like `**/fixtures/**`.

### PW-FLAKE-003 — test.only / test.skip left in codebase
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `test.only(`, `test.describe.only(`, `test.skip('...')` |

Permanent `test.only()` or `test.skip()` calls reduce coverage. Conditional skips inside test bodies are excluded.

### PW-FLAKE-004 — networkidle usage detected
| Property | Value |
|----------|------------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `waitForLoadState('networkidle')`, `waitUntil: 'networkidle'` |

`networkidle` is unreliable in modern SPAs with background traffic.

### PW-FLAKE-005 — Non-retrying assertions used
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `expect(await locator.isVisible())` and similar non-web-first assertions |

Non-retrying assertions lead to flaky tests. Prefer Playwright web-first assertions.

### PW-FLAKE-006 — test.fixme markers
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Flakiness |
| Patterns | `test.fixme(` |

`test.fixme()` indicates deferred broken tests and growing test debt.

---

## Stability Rules (PW-STABILITY-*)

### PW-STABILITY-001 — Missing cleanup hooks
| Property | Value |
|----------|-------|
| Severity | **Medium** / **High** (with retries) |
| Category | Stability |
| Escalation | **High** when retries are enabled |

Test files without `afterEach` or `afterAll` hooks risk leaking state between tests.

### PW-STABILITY-001a — beforeAll / afterAll usage info
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Stability |
| Type | Informational |

Informational: files using `beforeAll`/`afterAll` for shared setup/teardown.

### PW-STABILITY-002 — Missing describe blocks
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Stability |
| Trigger | 3+ tests in a file without `describe()` |

Test files with 3+ tests but no `describe()` blocks lack organizational structure.

### PW-STABILITY-003 — Page fixture in beforeAll
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Stability |

Using the `page` fixture in `beforeAll` shares browser state across tests and causes cascading failures.

### PW-STABILITY-004 — Tests without assertions
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Stability |
| Analysis | Expect count < 50% of test count per file |

Tests without assertions never fail and provide no signal. When retries are enabled this is superseded by PW-INSIGHT-011.

### PW-STABILITY-005 — Browser resource leak risk
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Stability |
| Patterns | `chromium.launch()`, `browser.newContext()`, `browser.newPage()` without corresponding `.close()` |

Manual browser/context/page creation without cleanup in afterEach/afterAll leaks resources. Use Playwright fixtures (({ page })) which auto-cleanup.

> **Variable-based cleanup recognized:** When resources are assigned to variables (e.g., `slPage = await slContext.newPage()`) and those variables are closed in `afterAll`/`afterEach` hooks (e.g., `slPage?.close()`), the rule correctly suppresses the finding. Both literal cleanup (`page.close()`) and variable-based cleanup (`slPage?.close()`) are supported.

### PW-STABILITY-006 — Too many assertions per test
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Stability |
| Trigger | ≥3 files with >5 expect() calls in a single test body |

Tests with excessive assertions verify too many behaviors at once, making failures harder to debug. Split into focused tests.

---

## Locator Rules (PW-LOC-*)

### PW-LOC-001 — XPath selectors detected
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Locators |
| Patterns | `locator('//...')`, `xpath=` |

XPath selectors are brittle and less maintainable than role/label/testid locators. Prefer `getByRole`, `getByLabel`.

### PW-LOC-002 — Deep CSS nesting (>3 levels)
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Locators |
| Analysis | CSS combinator depth |

Deeply nested CSS selectors (e.g., `div > span > div > a > span.text`) are brittle and break with minor DOM changes.

### PW-LOC-003 — Index-based selectors (nth/first/last)
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Locators |
| Patterns | `.nth()`, `.first()`, `.last()` |

Index-based selectors break when list order changes. Use semantic locators when possible.

---

## Performance Rules (PW-PERF-*)

### PW-PERF-001 — page.goto using networkidle
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Performance |
| Patterns | `page.goto(... waitUntil: 'networkidle')` |

`networkidle` on navigation is explicitly discouraged by Playwright docs.

### PW-PERF-002 — Hardcoded URLs detected in tests
| Property | Value |
|----------|-------|
| Severity | **Medium** (downgraded to **Low** when baseURL is configured) |
| Category | Performance |

Hardcoded URLs (http://, https://) prevent easy environment switching. Use `baseURL` + relative paths.

### PW-PERF-003 — networkidle + high timeout correlation
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Performance |
| Trigger | `networkidle` usage plus test timeout > 60s |

Hidden slow tests and unreliable waits compound each other.

---

## Deprecated API Rules (PW-DEPREC-*)

### PW-DEPREC-001 — Deprecated selector engine methods ($, $$, $eval, $$eval)
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Deprecated API |

Legacy ElementHandle-based APIs that should be replaced with Locators.

### PW-DEPREC-002 — Deprecated page.action(selector) methods
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Deprecated API |

Selector-string convenience methods like `page.click('sel')` should be replaced with `page.locator('sel').click()`.

### PW-DEPREC-003 — Deprecated waitForNavigation / waitForSelector
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Deprecated API |

Legacy waits with race-condition risk; use `page.waitForURL()` or `locator.waitFor()`.

### PW-DEPREC-004 — test.describe.serial usage (isolation risk)
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Deprecated API |

Serial groups create dependencies. Prefer isolated tests or `test.describe.configure({ mode: 'serial' })`.

### PW-DEPREC-005 — Deprecated snapshotDir config
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Deprecated API |

Use `snapshotPathTemplate` instead of `snapshotDir`.

### PW-DEPREC-006 — Deprecated BrowserContext methods
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Deprecated API |

`setHTTPCredentials`, `backgroundPages`, and `backgroundpage` event are deprecated.

### PW-DEPREC-007 — Deprecated page.type / locator.type
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Deprecated API |

Use `fill()` for input values or `pressSequentially()` when needed.

### PW-DEPREC-008 — Deprecated layout selectors
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Deprecated API |

Layout pseudo-selectors like `:left-of`, `:right-of`, `:above`, `:below`, `:near` are deprecated.

---

## Dependency Rules (DEP-*)

### DEP-001 — Outdated Playwright dependencies
| Property | Value |
|----------|-------|
| Severity | **Low** / **Medium** |
| Category | Dependencies |
| Trigger | Major version behind => **Medium**; pinned minor behind => **Low** |

Tracks Playwright-related packages that are behind the latest published versions.

### DEP-002 — Deprecated npm package detected
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Dependencies |
| Trigger | npm registry marks latest version as deprecated |

Deprecated packages can be unmaintained or vulnerable. Migrate to the recommended replacement.

---

## Architecture Rules (ARCH-*)

### ARCH-001 — No shared base pattern across Page Objects
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |

Multiple POMs without a shared base class or consistent fixtures.

### ARCH-002 — Public locators in POMs
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |

POMs exposing locators as public properties instead of encapsulating them in methods.

### ARCH-003 — Test-to-test imports
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Architecture |

Test files importing from other test files creates coupling and execution order dependencies.

### ARCH-004 — Missing fixture typing
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Architecture |

Custom fixtures (`test.extend()`) without TypeScript type definitions.

### ARCH-005 — Hardcoded credentials
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Architecture / Security |

Passwords, API keys, and tokens hardcoded in test files.

### ARCH-005a — Hardcoded email addresses
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |

Hardcoded email addresses in test files (risk of collisions in shared environments).

### ARCH-006 — No API route mocking
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |

No `page.route()` usage detected. API mocking can make tests faster and more reliable.

### ARCH-007 — No custom error handling in POMs
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |

POM classes without custom error classes for better failure diagnostics.

### ARCH-008 — Large inline test data
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Architecture |
| Analysis | Large inline data blocks (>=50 lines) |

Large data blocks inline in test files. Extract to JSON fixtures or data factories.

### ARCH-009 — Inline config overrides
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |
| Analysis | Custom (detects timeout/retries in test() call objects) |
| Threshold | ≥3 occurrences across the repo |

Tests overriding `timeout` or `retries` inline. Use `test.use()` or project config instead.

### ARCH-010 — Hardcoded inline test data
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |
| Scope | Cross-framework (Playwright, Cypress, Selenium) |
| Analysis | Detects variable-name-anchored inline data: usernames, addresses, dates, prices, credit cards, zip codes |
| Threshold | ≥3 matches per file, ≥2 files total |

Inline test data (usernames, addresses, dates, prices) should be extracted to fixture files or generated with faker/data factories for easier maintenance and reuse.

### ARCH-011 — Emoji characters in log messages
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |
| Scope | Cross-framework |
| Patterns | `console.log/warn/error/info/debug()` calls containing emoji (Unicode Extended_Pictographic) |

Emoji in console output can render as garbled characters (mojibake) or cause parsing issues in CI log aggregators, SIEM tools, and plain-text report archivers. Replace with plain-text equivalents (e.g., `[PASS]`, `[FAIL]`, `[WARN]`).

---

## CI/CD Rules (CI-*)

### CI-001 — No CI pipeline detected
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | CI/CD |

No Azure Pipelines or GitHub Actions YAML files were detected.

### CI-002 — Missing report publishing
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | CI/CD |

Playwright HTML report publishing not detected.

### CI-003 — Missing JUnit publishing
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | CI/CD |

JUnit test results not clearly published.

### CI-004 — Missing WORKERS env in CI
| Property | Value |
|---|---|
| Severity | **Medium** |
| Category | CI/CD |
| Trigger | Config uses WORKERS but pipeline does not |

Worker configuration can drift between environments.

### CI-005 — Missing dependency caching
| Property | Value |
|---|---|
| Severity | **Low** / **Medium** |
| Category | CI/CD |
| Escalation | **Medium** on Microsoft-hosted agents |

No dependency caching detected.

### CI-006 — Inconsistent WORKERS across pipelines
| Property | Value |
|---|---|
| Severity | **Low** / **Medium** / **High** |
| Category | CI/CD |
| Trigger | Coverage varies across pipelines |

WORKERS is set in some pipelines but not others.

### CI-007 — Missing test sharding
| Property | Value |
|---|---|
| Severity | **Medium** / **High** |
| Category | CI/CD |
| Escalation | **High** for very large suites |

Sharding is recommended for large test suites.

### CI-008 — Playwright install without --with-deps
| Property | Value |
|---|---|
| Severity | **Medium** |
| Category | CI/CD |
| Trigger | Microsoft-hosted agents, `npx playwright install` without `--with-deps` |

Missing system dependencies can break browser launches.

### CI-009 — Retries enabled but artifacts not published
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | CI/CD |

Retries are enabled but test artifacts (traces/videos) are not published.

### CI-010 — Artifacts not guaranteed on failure
| Property | Value |
|---|---|
| Severity | **Medium** |
| Category | CI/CD |

Artifacts are published but not under always()/failed() conditions.

### CI-011 — Missing playwright install command
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | CI/CD |

No `npx playwright install` detected and browsers not preinstalled.

### CI-012 — CI env variable mismatch
| Property | Value |
|---|---|
| Severity | **Medium** |
| Category | CI/CD |
| Trigger | Config uses process.env.CI, Azure pipelines do not set CI=true |

CI-specific settings may not activate in Azure Pipelines.

### CI-013 — Missing or excessive pipeline timeout
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | CI/CD |
| Trigger | No timeout set or > 120 minutes |

No `timeoutInMinutes` set, or set above 120 minutes. Without a timeout, stuck tests consume CI resources indefinitely.

### CI-014 — No reporter override in CI command
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | CI/CD |

The CI playwright test command doesn't specify `--reporter`. CI may benefit from different reporters (e.g., JUnit for test results publishing).

---

## Insight / Correlation Rules (PW-INSIGHT-*)

### PW-INSIGHT-001 — Flakiness trifecta (retries + hard waits + force clicks)
| Property | Value |
|---|---|
| Severity | **High** |
| Category | Insight |
| Trigger | PW-FLAKE-001 + PW-FLAKE-002 + retries enabled |

Masked flakiness is likely; prioritize removing hard waits and force clicks.

### PW-INSIGHT-002 — Excessive test timeout
| Property | Value |
|---|---|
| Severity | **Medium** |
| Category | Insight |
| Trigger | test timeout > 120s |

Very high timeouts hide performance issues.

### PW-INSIGHT-003 — No explicit expect/action timeout
| Property | Value |
|---|---|
| Severity | **Low** |
| Category | Insight |
| Trigger | No expect.timeout or actionTimeout configured |

Explicit timeouts improve clarity and predictability.

### PW-INSIGHT-004 — Excessive retries
| Property | Value |
|---|---|
| Severity | **Medium** |
| Category | Insight |
| Trigger | retries > 2 |

Retries should be minimal and focused on rare infra flake.

### PW-INSIGHT-005 — Trace capture not configured
| Property | Value |
|---|---|
| Severity | **High** |
| Category | Insight |
| Trigger | trace disabled or not set |

Traces are the primary debugging mechanism for CI failures.

### PW-INSIGHT-006 — Video capture not configured
| Property | Value |
|---|---|
| Severity | **Low** |
| Category | Insight |
| Trigger | video disabled or not set |

Videos are helpful but less important than traces.

### PW-INSIGHT-007 — High fixed worker count
| Property | Value |
|---|---|
| Severity | **Low** |
| Category | Insight |
| Trigger | workers > 8 |

Hardcoded high workers can overwhelm local environments.

### PW-INSIGHT-008 — Debugging black hole
| Property | Value |
|---|---|
| Severity | **Medium** / **High** |
| Category | Insight |
| Trigger | retries enabled + missing trace/video/artifacts |

Failures are retried but no artifacts exist for debugging.

### PW-INSIGHT-009 — networkidle + hard waits correlation
| Property | Value |
|---|---|
| Severity | **High** |
| Category | Insight |
| Trigger | PW-PERF-001 + PW-FLAKE-001 |

Unreliable waits are compounding each other.

### PW-INSIGHT-010 — Hardcoded URLs without baseURL
| Property | Value |
|---|---|
| Severity | **Medium** / **High** |
| Category | Insight |
| Trigger | Hardcoded URLs + no baseURL (escalates with high workers) |

Environment switching is brittle, especially at scale.

### PW-INSIGHT-011 — "Green but useless" tests
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Insight |
| Trigger | PW-STABILITY-004 (no assertions) AND retries enabled |

Tests without assertions combined with retries create an illusion of quality — they never fail because they never check anything.

### PW-INSIGHT-012 — Suite scale vs CI parallelism mismatch
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Insight |
| Trigger | ≥500 test files with workers ≤ 2 |

A large test suite with very low parallelism wastes CI time and delays feedback. Increase workers or enable sharding.

### PW-INSIGHT-013 — E2E-only test strategy detected
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Insight |
| Trigger | >70% of tests use `page.goto()` (no component/API test layer) |

Relying exclusively on E2E tests for all validation is slow, expensive, and fragile. Add component tests or API tests for faster feedback on business logic.

### PW-INSIGHT-014 — Missing forbidOnly in Playwright config
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Insight |
| Trigger | `forbidOnly` not set in Playwright config |

Without `forbidOnly`, a `test.only()` can silently leak into CI and skip the rest of the suite. Enable `forbidOnly` in CI configurations.

### PW-INSIGHT-015 — Retries not CI-conditional
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Insight |
| Trigger | retries enabled unconditionally (not gated on `process.env.CI`) |

Retries should be CI-only to surface local flakiness. Use `retries: process.env.CI ? 2 : 0` pattern.

---

## Cypress Rules (CY-*)

### CY-FLAKE-001 — Hard waits in Cypress
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `cy.wait(<ms>)` |

`cy.wait(ms)` introduces brittle hard waits. Replace with `cy.intercept()` + `cy.wait('@alias')` or assertion-based waits.

### CY-FLAKE-002 — Fragile CSS selectors (missing data-cy / data-testid)
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Flakiness |
| Patterns | `cy.get('.class')`, `cy.get('#id')` |

Prefer `data-cy` or `data-testid` selectors.

### CY-FLAKE-003 — Force-click usage in Cypress
| Property | Value |
|---|---|
| Severity | **Medium** |
| Category | Flakiness |
| Patterns | `{ force: true }` |

Force-clicking bypasses actionability checks and hides real UI issues.

### CY-LOC-001 — XPath selectors in Cypress
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Locators |
| Patterns | `cy.xpath()` or XPath strings |

XPath in Cypress requires a plugin and is verbose/fragile. Use Cypress-native selectors.

### CY-PERF-001 — Missing baseUrl in Cypress config
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Performance / Config |
| Trigger | `baseUrl` not set in cypress.config.ts |

Without `baseUrl`, every `cy.visit()` needs a full URL, making environment switching difficult.

### CY-PERF-002 — Excessive defaultCommandTimeout
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Performance / Config |
| Trigger | `defaultCommandTimeout > 30000` |

High timeouts mask slow application responses and make failing tests hang.

### CY-STABILITY-001 — No cy.intercept() usage
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Stability |
| Trigger | No `cy.intercept()` in any Cypress test files (≥5 test files) |

Network interception enables faster, deterministic tests by mocking API responses.

---

## Selenium Rules (SE-*)

### SE-FLAKE-001 — Hard waits in Selenium (Thread.sleep / time.sleep)
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `Thread.sleep()`, `time.sleep()`, `driver.sleep()` |
| File Globs | `**/*.py`, `**/*.java`, `**/*.ts`, `**/*.js` |

Hard sleeps introduce non-deterministic waits. Use explicit waits (WebDriverWait) instead.

### SE-FLAKE-002 — Implicit waits detected
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Flakiness |
| Patterns | `implicitly_wait()`, `implicitlyWait()` |

Mixing implicit and explicit waits causes unpredictable wait behavior. Use explicit waits exclusively.

### SE-LOC-001 — XPath selectors in Selenium
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Locators |
| Patterns | `By.xpath()`, `By.XPATH`, `find_element(By.XPATH, ...)` |

XPath selectors are verbose and fragile. Prefer CSS selectors, `By.id`, `By.name`, or data-testid attributes.

### SE-STABILITY-001 — WebDriver resource leak risk
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Stability |
| Patterns | `webdriver.Chrome()`, `new ChromeDriver()` without `driver.quit()` in teardown |

Selenium has no auto-cleanup. Missing `driver.quit()` in teardown leaks browser processes.

---

## System Rules (SCAN-*)

### SCAN-MISSING-REPO — Repository path not found
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | System |
| Trigger | Target repository path does not exist |

Emitted when the target repository path passed to the scanner does not exist or is inaccessible.

---

## Rule Count Summary

| Category | Count |
|----------|-------|
| Flakiness (PW-FLAKE) | 6 |
| Stability (PW-STABILITY) | 7 |
| Locators (PW-LOC) | 3 |
| Performance (PW-PERF) | 3 |
| Deprecated API (PW-DEPREC) | 8 |
| Dependencies (DEP) | 2 |
| Architecture (ARCH) | 12 |
| CI/CD (CI) | 14 |
| Insights (PW-INSIGHT) | 15 |
| Cypress (CY) | 7 |
| Selenium (SE) | 4 |
| System (SCAN) | 1 |
| **Total** | **82** |

---

## Health Scoring

Findings are weighted by type and severity to produce risk points, which are then converted to a **0–100 health score** (higher = better) using exponential decay:

```
healthScore = round(100 × exp(-riskPoints / 80))
```

### Severity weights

| Severity | Base points |
|----------|-------------|
| Low | 1 |
| Medium | 2 |
| High | 3 |

### Category multipliers

| Finding prefix | Multiplier | Rationale |
|----------------|------------|-----------|
| `PW-INSIGHT-*` | 1.5× | Correlated findings are higher signal |
| `CI-*` | 1.3× | CI issues affect the entire pipeline |
| `ARCH-*` | 1.2× | Architecture issues compound over time |
| All others | 1.0× | — |

### Evidence scaling

Each finding's evidence count is factored in using a log₂ scale, capped at 3.5×:

```
evidenceMultiplier = min(1 + log₂(max(evidenceCount, 1)), 3.5)
```

### Density normalization

When inventory data is available, the decay constant (λ) is scaled by suite size so that larger test suites are evaluated more leniently. The rationale: 24 findings scattered across 981 test files is a healthier codebase than 18 findings concentrated in 105 test files.

```
effectiveTestFiles = testFiles + cypressTestFiles + seleniumTestFiles
densityFactor      = clamp(1.0 + 0.5 × log₂(max(effectiveTestFiles / 50, 1)), 1.0, 3.5)
adjustedLambda     = 80 × densityFactor
healthScore        = round(100 × exp(-riskPoints / adjustedLambda))
```

| Suite size | densityFactor | Effective λ | Effect |
|------------|--------------|-------------|--------|
| ≤ 50 files | 1.0 | 80 | No adjustment (neutral) |
| 100 files | 1.5 | 120 | Moderate relief |
| 200 files | 2.0 | 160 | Significant relief |
| 500 files | 2.16 | 173 | Strong relief |
| 1,000 files | 2.66 | 213 | High relief |
| 3,200+ files | 3.5 (cap) | 280 | Maximum relief |

When no inventory is provided or test files ≤ 0, `densityFactor = 1.0` (identical to pre-density behavior).

### Grade thresholds

| Grade | Health Score | Level | Description |
|-------|-------------|-------|-------------|
| A | ≥ 80 | Excellent | Framework follows best practices |
| B | ≥ 50 | Good | Minor issues, normal maintenance needed |
| C | ≥ 30 | Fair | Notable issues requiring attention |
| D | ≥ 15 | Poor | Serious issues, prioritize remediation |
| F | < 15 | Critical | Systemic issues across the framework |

### Worked examples

| Risk points | Health score | Grade |
|-------------|-------------|-------|
| 0 | 100 | A |
| 20 | 78 | B |
| 50 | 54 | B |
| 85 | 35 | C |
| 120 | 22 | D |
| 164 | 13 | F |

Grade thresholds are customizable via `.auditrc.json`:

```json
{
  "thresholds": {
    "gradeA": 80,
    "gradeB": 50,
    "gradeC": 30
  }
}
```
