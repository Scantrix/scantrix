# Rules Reference

Complete catalog of all audit rules implemented in Repo Audit Agent v3.0.0.

---

## Flakiness Rules (PW-FLAKE-*)

### PW-FLAKE-001 — Hard waits detected
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `waitForTimeout`, `setTimeout` in test files |

Hard waits (`page.waitForTimeout()`, `setTimeout`) make tests slow and flaky. Replace with explicit waits like `expect(locator).toBeVisible()` or `page.waitForResponse()`.

### PW-FLAKE-002 — Force clicks detected
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Flakiness |
| Patterns | `{ force: true }` in click/fill calls |

Force clicks bypass actionability checks, hiding real UI issues (overlapping elements, not-ready state).

### PW-FLAKE-003 — test.only / test.skip detected
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `test.only(`, `test.skip(` (permanent definitions only) |

Permanent `test.skip()` and `test.only()` calls indicate abandoned or incomplete tests. Conditional skips inside test bodies (e.g., `test.skip(condition)`) are excluded.

### PW-FLAKE-004 — networkidle usage detected
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Flakiness |
| Patterns | `waitForLoadState('networkidle')`, `waitUntil: 'networkidle'` |

`networkidle` waits for zero network activity for 500ms, which is unreliable in SPAs with background requests (analytics, websockets, polling).

---

## Stability Rules (PW-STABILITY-*)

### PW-STABILITY-001 — Missing cleanup hooks
| Property | Value |
|----------|-------|
| Severity | **Medium** / **High** (with retries) |
| Category | Stability |

Test files without `afterEach` or `afterAll` hooks risk leaking state between tests.

### PW-STABILITY-001a — beforeAll/afterAll usage info
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Stability |

Informational: files using `beforeAll`/`afterAll` for shared setup/teardown.

### PW-STABILITY-002 — Missing describe blocks
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Stability |

Test files with 3+ tests but no `describe()` blocks lack organizational structure.

### PW-STABILITY-003 — Page fixture in beforeAll
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Stability |

Using the `page` fixture in `beforeAll` shares browser state across tests, causing cascading failures.

### PW-STABILITY-004 — Tests without assertions
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Stability |
| Analysis | Custom (expect count vs test count per file) |

Files where `expect()` calls are less than 50% of test count. Tests without assertions never fail and provide no quality signal.

---

## Locator Rules (PW-LOC-*)

### PW-LOC-001 — XPath selectors detected
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Locators |
| Patterns | `locator('//...')`, `xpath=` |

XPath selectors are brittle and harder to maintain. Prefer `getByRole`, `getByLabel`, `getByTestId`.

### PW-LOC-002 — Deep CSS nesting (>3 levels)
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Locators |
| Analysis | Custom (CSS combinator counting) |

Deeply nested CSS selectors (e.g., `div > span > div > a > span.text`) are brittle and break with minor DOM changes.

### PW-LOC-003 — nth/first/last selectors
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Locators |
| Patterns | `.nth(`, `.first()`, `.last()` |

Index-based selectors break when list order changes. Use semantic locators when possible.

---

## Performance Rules (PW-PERF-*)

### PW-PERF-001 — page.goto without explicit waitUntil
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Performance |

`page.goto()` defaults to `waitUntil: 'load'`. For SPAs, `waitUntil: 'domcontentloaded'` is often faster.

### PW-PERF-002 — Hardcoded URLs in tests
| Property | Value |
|----------|-------|
| Severity | **Medium** (downgraded to **Low** if baseURL configured) |
| Category | Performance |

Hardcoded URLs (http://, https://) prevent easy environment switching. Use `baseURL` + relative paths.

### PW-PERF-003 — networkidle + high timeout correlation
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Performance |
| Trigger | PW-FLAKE-004 detected AND test timeout > 60s |

`networkidle` combined with a generous timeout means tests may silently wait much longer than necessary.

---

## Architecture Rules (ARCH-*)

### ARCH-001 — Missing BasePage pattern
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Architecture |

Multiple POM classes without a shared base class for common operations.

### ARCH-002 — Public locators in POMs
| Property | Value |
|----------|-------|
| Severity | **Medium** |
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
| Severity | **Medium** |
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
| Severity | **Low** |
| Category | Architecture |
| Analysis | Custom (brace-counting for blocks ≥50 lines) |

Large data blocks inline in test files. Extract to JSON fixtures or data factories.

### ARCH-009 — Inline config overrides
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Architecture |
| Analysis | Custom (detects timeout/retries in test() call objects) |
| Threshold | ≥3 occurrences across the repo |

Tests overriding `timeout` or `retries` inline. Use `test.use()` or project config instead.

---

## CI/CD Rules (CI-*)

### CI-001 — No CI pipeline detected
### CI-002 — Missing report publishing
### CI-003 — Missing trace/artifact publishing
### CI-004 — Missing artifact-on-failure condition
### CI-005 — Missing dependency caching
### CI-006 — Inconsistent WORKERS environment variable
### CI-007 — Missing test sharding
### CI-008 — Missing --with-deps in playwright install
### CI-009 — Missing test-results artifact
### CI-010 — Missing JUnit publishing

### CI-011 — Missing playwright install command
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | CI/CD |

No `npx playwright install` or equivalent found in CI pipeline. Browsers won't be available at runtime.

### CI-012 — CI environment variable mismatch
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | CI/CD |

Playwright config references `process.env.CI` but Azure Pipelines don't set `CI=true` by default (GitHub Actions does automatically).

### CI-013 — Missing or excessive pipeline timeout
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | CI/CD |

No `timeoutInMinutes` set, or set above 120 minutes. Without a timeout, stuck tests consume CI resources indefinitely.

### CI-014 — No reporter override in CI command
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | CI/CD |

The CI playwright test command doesn't specify `--reporter`. CI may benefit from different reporters (e.g., JUnit for test results publishing).

---

## Insight / Correlation Rules (PW-INSIGHT-*)

These rules correlate multiple findings to surface higher-level patterns.

### PW-INSIGHT-001 — Flakiness trifecta (retries + hard waits + force clicks)
### PW-INSIGHT-002 — Excessive test timeout
### PW-INSIGHT-003 — Complex test files
### PW-INSIGHT-004 — Global setup without teardown
### PW-INSIGHT-005 — Missing workers optimization
### PW-INSIGHT-006 — CI workers environment mismatch
### PW-INSIGHT-007 — No sharding with large suite
### PW-INSIGHT-008 — Missing trace/video in debug config
### PW-INSIGHT-009 — Missing artifacts on failure
### PW-INSIGHT-010 — Hardcoded URLs without baseURL

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
| Trigger | ≥500 test files AND workers ≤ 2 |

Large test suites with low parallelism lead to extremely long CI times.

### PW-INSIGHT-013 — E2E-only test strategy
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Insight |
| Trigger | Most tests navigate to full URLs with no baseURL |

Suggests an all-E2E strategy without component or API-level testing layers.

---

## Cypress Rules (CY-*)

### CY-FLAKE-001 — Hard waits in Cypress (cy.wait with numeric ms)
| Property | Value |
|----------|-------|
| Severity | **High** |
| Category | Flakiness |
| Patterns | `cy.wait(3000)`, `cy.wait(5000,` |
| File Globs | `**/*.cy.ts`, `**/*.cy.js`, `cypress/e2e/**/*`, `cypress/integration/**/*` |

`cy.wait(ms)` introduces brittle hard waits. Replace with `cy.intercept()` + `cy.wait('@alias')` or assertion-based waits.

### CY-FLAKE-002 — Fragile CSS selectors (missing data-cy / data-testid)
| Property | Value |
|----------|-------|
| Severity | **Medium** |
| Category | Flakiness |
| Patterns | `cy.get('.class')`, `cy.get('#id')` |

CSS class/ID selectors are tightly coupled to styling. Use `data-cy` or `data-testid` attributes instead.

### CY-LOC-001 — XPath selectors in Cypress
| Property | Value |
|----------|-------|
| Severity | **Low** |
| Category | Locators |
| Patterns | `cy.xpath()`, `cy.get('//...')` |

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
