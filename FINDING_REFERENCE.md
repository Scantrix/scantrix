# Audit Finding Reference Guide

## Quick Reference: All Finding IDs

### Flakiness Findings (PW-FLAKE-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| PW-FLAKE-001 | Hard waits detected | 🔴 HIGH | `waitForTimeout`, `setTimeout` usage |
| PW-FLAKE-002 | Force-click usage | 🟠 MEDIUM | `force: true` in clicks |
| PW-FLAKE-003 | test.only / test.skip detected | 🔴 HIGH | Permanent `test.only()` or `test.skip()` definitions |
| PW-FLAKE-004 | networkidle usage | 🔴 HIGH | `waitForLoadState('networkidle')` or `waitUntil: 'networkidle'` |
| PW-FLAKE-005 | Non-retrying assertions | 🔴 HIGH | `expect(await locator.isVisible()).toBe(true)` instead of web-first assertions |
| PW-FLAKE-006 | test.fixme() markers | 🟡 LOW | `test.fixme()` markers indicate deferred broken tests |

### Stability Findings (PW-STABILITY-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| PW-STABILITY-001 | Shared state risk | 🔴/🟠 HIGH/MED | 3+ tests without beforeEach/afterEach hooks |
| PW-STABILITY-001a | Test isolation could be improved | 🟡 LOW | beforeAll/afterAll only, no beforeEach/afterEach |
| PW-STABILITY-002 | Poor test organization | 🟠 MEDIUM | 10+ tests without describe blocks |
| PW-STABILITY-003 | Page fixture in beforeAll | 🔴 HIGH | `test.beforeAll(async ({ page }) => ...)` usage |
| PW-STABILITY-004 | Tests without assertions | 🔴 HIGH | expect() calls < 50% of test count |
| PW-STABILITY-005 | Browser resource leak risk | 🟠 MEDIUM | Manual browser/context/page creation without cleanup in afterEach/afterAll |
| PW-STABILITY-006 | Too many assertions per test | 🟡 LOW | >5 expect() calls in a single test body (≥3 tests over threshold) |

### Locator Findings (PW-LOC-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| PW-LOC-001 | XPath selectors | 🟠 MEDIUM | `locator('//...')` usage — Playwright docs strongly discourage XPath |
| PW-LOC-002 | Deep CSS nesting | 🟡 LOW | CSS selectors with >3 nesting levels |
| PW-LOC-003 | nth/first/last selectors | 🟠 MEDIUM | `.nth()`, `.first()`, `.last()` usage |

### Performance Findings (PW-PERF-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| PW-PERF-001 | page.goto using networkidle | 🟠 MEDIUM | `page.goto()` with `waitUntil: 'networkidle'` is unreliable; default `'load'` is preferred |
| PW-PERF-002 | Hardcoded URLs | 🟠/🟡 MED/LOW | Full URLs instead of relative paths with baseURL |
| PW-PERF-003 | networkidle + high timeout | 🟠 MEDIUM | networkidle combined with timeout > 60s |

### Configuration Insights (PW-INSIGHT-*)
| ID | Title | Severity | Triggers When |
|---|---|---|---|
| PW-INSIGHT-001 | Masked flakiness | 🔴 HIGH | Retries enabled + hard waits + force clicks |
| PW-INSIGHT-002 | Excessive test timeout | 🟠 MEDIUM | timeout > 120000ms (2 minutes) |
| PW-INSIGHT-003 | Missing timeout config | 🟡 LOW | No expect.timeout or actionTimeout |
| PW-INSIGHT-004 | Excessive retries | 🟠 MEDIUM | retries > 2 |
| PW-INSIGHT-005 | Missing trace config | 🔴 HIGH | trace = 'off' or not set — best-practices doc explicitly recommends trace |
| PW-INSIGHT-006 | Missing video config | 🟡 LOW | video = 'off' or not set |
| PW-INSIGHT-007 | High fixed workers | 🟡 LOW | workers hardcoded > 8 |
| PW-INSIGHT-008 | Debugging black hole | 🔴/🟠 HIGH/MED | Retries enabled + 2+ debug mechanisms missing |
| PW-INSIGHT-010 | Hardcoded URLs w/o baseURL | 🟠/🔴 MED/HIGH | Hardcoded URLs detected without baseURL configuration |
| PW-INSIGHT-011 | "Green but useless" tests | 🔴 HIGH | No assertions + retries enabled |
| PW-INSIGHT-012 | Scale vs parallelism mismatch | 🔴 HIGH | ≥500 test files with workers ≤ 2 |
| PW-INSIGHT-013 | E2E-only strategy | 🟡 LOW | Most tests use full URLs, no component/API layer |
| PW-INSIGHT-014 | Missing forbidOnly | 🔴 HIGH | Config lacks `forbidOnly` — test.only() can leak to CI |
| PW-INSIGHT-015 | Retries not CI-conditional | 🟠 MEDIUM | Retries set to fixed value instead of `process.env.CI ? 2 : 0` |

### CI Configuration Findings (CI-*)
| ID | Title | Severity | Triggers When |
|---|---|---|---|
| CI-001 | No CI detected | 🟠 MEDIUM | No pipeline YAML files found |
| CI-002 | Missing HTML report | 🔴 HIGH | Playwright report not published |
| CI-003 | Missing JUnit | 🟠 MEDIUM | JUnit results not published |
| CI-004 | WORKERS not set | 🟠 MEDIUM | Config uses WORKERS but CI doesn't set it |
| CI-005 | No dependency caching | 🟠/🟡 MED/LOW\* | No npm/node_modules caching (severity depends on agent pool type) |
| CI-006 | Inconsistent WORKERS | 🔴/🟠/🟡 | WORKERS set in some but not all pipelines |
| CI-007 | Missing sharding | 🔴/🟠 | Many test files (>100) without sharding |
| CI-008 | Missing --with-deps | 🟠 MEDIUM | playwright install without --with-deps |
| CI-009 | Missing failure artifacts | 🔴 HIGH | Retries enabled but artifacts not published |
| CI-010 | Artifacts not on failure | 🟠 MEDIUM | Artifacts published but no always()/failed() condition |
| CI-011 | Missing playwright install | 🟠 MEDIUM | No `npx playwright install` in CI pipeline |
| CI-012 | CI env variable mismatch | 🟠 MEDIUM | Config uses `process.env.CI` but pipeline doesn't set CI=true |
| CI-013 | Missing pipeline timeout | 🟡 LOW | No timeoutInMinutes or > 120 minutes |
| CI-014 | No reporter override in CI | 🟠 MEDIUM | `npx playwright test` without `--reporter` flag — docs recommend CI-conditional reporters |

\* Severity depends on agent pool type

### Architecture Findings (ARCH-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| ARCH-001 | No shared base pattern across POMs | 🟡 LOW | POMs lack common base — consider fixtures over inheritance per Playwright docs |
| ARCH-002 | Consider encapsulating locator interactions | 🟡 LOW | Public locators are OK per docs; flag complex interaction patterns |
| ARCH-003 | Test coupling | 🔴 HIGH | Tests importing from other test files |
| ARCH-004 | Missing fixture typing | 🟠 MEDIUM | `any` types in fixture definitions |
| ARCH-005 | Hardcoded credentials | 🔴 HIGH | Passwords/API keys in test code |
| ARCH-005a | Hardcoded emails | 🟡 LOW | Email addresses hardcoded in tests |
| ARCH-006 | No API mocking | 🟡 LOW | No page.route() usage detected |
| ARCH-007 | No custom error types | 🟡 LOW | Generic Error throws without custom classes |
| ARCH-008 | Large inline test data | 🟠 MEDIUM | Data blocks ≥50 lines inline in test files (≥2 files) |
| ARCH-009 | Inline config overrides | 🟡 LOW | timeout/retries set inline in test() calls (≥3 occurrences) |
| ARCH-010 | Hardcoded inline test data | 🟡 LOW | Variable-anchored inline data (usernames, addresses, dates, prices) in ≥2 files |

### Deprecated API Findings (PW-DEPREC-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| PW-DEPREC-001 | Deprecated `$`/`$$`/`$eval`/`$$eval` | 🟠 MEDIUM | Legacy selector engine methods → use `page.locator()` |
| PW-DEPREC-002 | Deprecated `page.action(selector)` | 🟠 MEDIUM | `page.click('sel')`, etc. → use `page.locator('sel').click()` |
| PW-DEPREC-003 | Deprecated `waitForNavigation`/`waitForSelector` | 🟠 MEDIUM | Use `page.waitForURL()` / `locator.waitFor()` |
| PW-DEPREC-004 | test.describe.serial usage (isolation risk) | 🟠 MEDIUM | `test.describe.serial()` — docs recommend isolated tests instead |
| PW-DEPREC-005 | Deprecated `snapshotDir` config | 🟡 LOW | Use `snapshotPathTemplate` instead |
| PW-DEPREC-006 | Deprecated BrowserContext methods | 🟡 LOW | `setHTTPCredentials`, `backgroundPages` |
| PW-DEPREC-007 | Deprecated page.type() / locator.type() | 🟠 MEDIUM | Deprecated in v1.39 — use `fill()` or `pressSequentially()` |
| PW-DEPREC-008 | Deprecated layout selectors | 🟠 MEDIUM | `:left-of`, `:right-of`, `:above`, `:below`, `:near` deprecated |

### Dependency Findings (DEP-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| DEP-001 | Outdated Playwright dependencies | 🟠 MEDIUM | Playwright-related packages are behind the latest published version |
| DEP-002 | Deprecated npm package | 🔴 HIGH | A Playwright-related dependency is marked as deprecated on npm |

### Cypress Findings (CY-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| CY-FLAKE-001 | Hard waits (cy.wait) | 🔴 HIGH | `cy.wait(number)` usage in Cypress tests |
| CY-FLAKE-002 | Fragile CSS selectors | 🟠 MEDIUM | `cy.get('.class')` / `cy.get('#id')` without data-cy |
| CY-FLAKE-003 | Force-click usage in Cypress | 🟠 MEDIUM | `{ force: true }` bypasses actionability checks |
| CY-LOC-001 | XPath selectors | 🟡 LOW | `cy.xpath()` or XPath expressions in Cypress |
| CY-PERF-001 | Missing baseUrl | 🟠 MEDIUM | Cypress config lacks baseUrl |
| CY-PERF-002 | Excessive timeout | 🟠 MEDIUM | defaultCommandTimeout > 30s |
| CY-STABILITY-001 | No network interception | 🟡 LOW | No `cy.intercept()` usage across test files |

### Selenium Findings (SE-*)
| ID | Title | Severity | Description |
|---|---|---|---|
| SE-FLAKE-001 | Hard waits (sleep) | 🔴 HIGH | `Thread.sleep()`, `time.sleep()`, `driver.sleep()` |
| SE-FLAKE-002 | Implicit waits | 🟠 MEDIUM | `implicitly_wait()` / `implicitlyWait()` |
| SE-LOC-001 | XPath selectors | 🟡 LOW | `By.xpath()`, `By.XPATH` usage |
| SE-STABILITY-001 | WebDriver resource leak risk | 🟠 MEDIUM | WebDriver creation without `driver.quit()` in teardown hook |

### Special Findings
| ID | Title | Severity | Description |
|---|---|---|---|
| SCAN-MISSING-REPO | Repository path not found | 🔴 HIGH | Target repo path does not exist — no files scanned |

## Severity Prioritization Guide

### 🔴 Critical/High Priority
**Fix immediately - impacts reliability or debugging**

1. **PW-FLAKE-001** - Hard waits are the #1 cause of flaky tests
2. **PW-FLAKE-004** - networkidle is unreliable in modern SPAs — Playwright docs strongly discourage it
3. **PW-FLAKE-005** - Non-retrying assertions lead to flaky tests (use web-first assertions)
4. **PW-INSIGHT-001** - You're masking problems, not fixing them
5. **PW-INSIGHT-005** - Traces are essential for CI debugging — best-practices doc explicitly recommends
6. **PW-INSIGHT-014** - Missing forbidOnly lets test.only() leak to CI silently
7. **PW-STABILITY-001** (with retries) - Test isolation issues masked by retries
8. **PW-STABILITY-003** - Shared browser state risk: `page` used in `beforeAll`
9. **PW-STABILITY-004** - Tests without assertions are "green noise" providing zero quality signal
10. **PW-INSIGHT-008** - Debugging black hole: retries without debug artifacts
11. **PW-INSIGHT-011** - "Green but useless" tests: no assertions + retries = false confidence
12. **ARCH-003** - Test coupling creates fragile, unpredictable tests
13. **ARCH-005** - Hardcoded credentials are a security and maintainability risk
14. **CI-002** - You can't debug failures without HTML reports
15. **CI-009** - Retries enabled but no artifacts to debug failures
16. **CI-007** (>500 files) - CI time is likely unbearable
17. **DEP-002** - Deprecated npm packages may be unmaintained or vulnerable

### 🟠 Medium Priority
**Fix in next sprint - quality of life improvements**

1. **PW-STABILITY-001** (no retries) - Isolation issues cause cascading failures
2. **PW-STABILITY-002** - Large unorganized test files hard to maintain
3. **PW-STABILITY-005** - Browser resource leaks can exhaust system resources
4. **PW-FLAKE-002** - Force clicks hide real issues
5. **PW-LOC-001** - XPath is brittle and strongly discouraged by Playwright docs
6. **PW-DEPREC-001** - Deprecated `$`/`$$` methods will be removed in future Playwright versions
7. **PW-DEPREC-002** - Deprecated `page.action(selector)` methods — migrate to locator API
8. **PW-DEPREC-003** - Deprecated wait methods — use modern `waitForURL`/`locator.waitFor()`
9. **PW-DEPREC-004** - `test.describe.serial` creates isolated test dependencies
10. **PW-DEPREC-007** - `page.type()` / `locator.type()` deprecated in v1.39
11. **PW-DEPREC-008** - Layout selectors (`:left-of`, `:right-of`, etc.) deprecated
12. **PW-INSIGHT-002** - Long timeouts hide performance problems
13. **PW-INSIGHT-004** - Too many retries mask flakiness
14. **PW-INSIGHT-015** - Retries should be CI-conditional (`process.env.CI ? 2 : 0`)
15. **CI-014** - CI-conditional reporters recommended by best-practices doc
16. **ARCH-004** - Untyped fixtures lose type safety benefits
17. **ARCH-008** - Large inline test data blocks bloat files and reduce readability
18. **CI-003** - Test result tracking improves DevOps visibility
19. **CI-004** - Env vars should be explicit
20. **CI-006** - Inconsistency causes confusion
21. **CI-007** (>100 files) - Sharding will speed up CI
22. **CI-008** - Missing deps cause hard-to-debug failures
23. **CI-011** - Missing playwright install causes browser-not-found failures
24. **CI-012** - CI env var mismatch causes config divergence
25. **DEP-001** - Outdated Playwright dependencies — stay current to reduce bugs

### 🟡 Low Priority
**Fix when refactoring - nice to have**

1. **PW-FLAKE-006** - test.fixme() markers indicate deferred broken tests
2. **PW-STABILITY-001a** - Test isolation improvements (beforeAll/afterAll only)
3. **PW-STABILITY-006** - Over-asserted tests are harder to debug
4. **PW-LOC-002** - Deeply nested CSS selectors are fragile to DOM changes
5. **PW-DEPREC-005** - Deprecated `snapshotDir` — use `snapshotPathTemplate`
6. **PW-DEPREC-006** - Deprecated BrowserContext methods
7. **PW-INSIGHT-003** - Explicit timeouts improve clarity
8. **PW-INSIGHT-006** - Videos helpful but traces more important
9. **PW-INSIGHT-007** - Fixed workers reduce flexibility
10. **PW-INSIGHT-013** - E2E-only test strategy (missing test pyramid)
11. **ARCH-001** - No shared base pattern — consider fixtures over inheritance
12. **ARCH-002** - Public locators OK per docs; encapsulate complex interactions
13. **ARCH-005a** - Hardcoded emails cause parallel test conflicts
14. **ARCH-006** - API mocking enables faster, more isolated tests
15. **ARCH-007** - Custom error types improve debugging
16. **ARCH-009** - Inline config overrides should use test.use()
17. **ARCH-010** - Hardcoded inline test data reduces maintainability
18. **CI-005** (self-hosted) - Caching less critical if deps cached
19. **CI-013** - Pipeline timeout guards prevent stuck runs

## Common Remediation Patterns

### Pattern 1: Fix Hard Waits (PW-FLAKE-001)

 **Before:**
```typescript
await page.click('#submit');
await page.waitForTimeout(2000); // Wait for API
await expect(page.locator('.success')).toBeVisible();
```

 **After:**
```typescript
await page.click('#submit');
// Playwright auto-waits for element to be visible
await expect(page.locator('.success')).toBeVisible();
// Or wait for specific network request
await page.waitForResponse(resp => resp.url().includes('/api/submit'));
```

### Pattern 2: Fix Force Clicks (PW-FLAKE-002)

 **Before:**
```typescript
await page.locator('.modal-close').click({ force: true });
```

 **After:**
```typescript
// Wait for element to be actionable first
await expect(page.locator('.modal-close')).toBeVisible();
await expect(page.locator('.modal-close')).toBeEnabled();
await page.locator('.modal-close').click();
```

### Pattern 3: Configure Timeouts (PW-INSIGHT-002, 003)

 **Before:**
```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 300000, // 5 minutes!
  // No explicit expect/action timeouts
});
```

 **After:**
```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 60000, // 1 minute for full test
  expect: {
    timeout: 15000, // 15s for assertions
  },
  use: {
    actionTimeout: 30000, // 30s for actions
  },
});
```

### Pattern 4: Reduce Retries (PW-INSIGHT-004)

 **Before:**
```typescript
export default defineConfig({
  retries: process.env.CI ? 5 : 0, // Too many!
});
```

 **After:**
```typescript
export default defineConfig({
  retries: process.env.CI ? 1 : 0, // 1-2 max
  // Focus on fixing flaky tests, not masking them
});
```

### Pattern 5: Enable Traces (PW-INSIGHT-005)

 **Before:**
```typescript
export default defineConfig({
  use: {
    trace: 'off',
  },
});
```

 **After:**
```typescript
export default defineConfig({
  use: {
    trace: 'retain-on-failure', // Only save on failure
    // OR for flaky tests:
    // trace: 'on-first-retry',
  },
});
```

### Pattern 6: Environment-Aware Workers (PW-INSIGHT-007)

 **Before:**
```typescript
export default defineConfig({
  workers: 16, // Hardcoded
});
```

 **After:**
```typescript
export default defineConfig({
  workers: process.env.WORKERS
    ? parseInt(process.env.WORKERS)
    : process.env.CI
      ? 4
      : 2,
});
```

### Pattern 7: CI Sharding (CI-007)

 **Before:**
```yaml
# azure-pipelines.yml
- script: npx playwright test
  # Runs all 500+ tests serially
```

 **After:**
```yaml
# azure-pipelines.yml
strategy:
  matrix:
    shard-1: { SHARD: '1/4' }
    shard-2: { SHARD: '2/4' }
    shard-3: { SHARD: '3/4' }
    shard-4: { SHARD: '4/4' }
steps:
  - script: npx playwright test --shard=$(SHARD)
```

### Pattern 8: Playwright Install with Deps (CI-008)

 **Before:**
```yaml
- script: npx playwright install
```

 **After:**
```yaml
- script: npx playwright install --with-deps
  # Ensures system dependencies are installed
```

### Pattern 9: Standardize WORKERS (CI-004, CI-006)

 **Before:**
```yaml
# Some pipelines set WORKERS, others don't
# azure-test-api.yml
env:
  WORKERS: 4

# azure-integration.yml
# (no WORKERS env)
```

 **After:**
```yaml
# ALL pipelines set WORKERS explicitly
# azure-test-api.yml
env:
  WORKERS: 4

# azure-integration.yml
env:
  WORKERS: 2  # Lower for integration tests
```

### Pattern 10: Publish Test Artifacts (CI-009, PW-INSIGHT-008)

 **Before:**
```yaml
# azure-pipelines.yml
- script: npx playwright test
  displayName: 'Run Playwright tests'
# No artifact publishing - retry failures are invisible!
```

 **After (Azure Pipelines):**
```yaml
- script: npx playwright test
  displayName: 'Run Playwright tests'
  continueOnError: true  # Don't fail the step immediately

- task: PublishPipelineArtifact@1
  displayName: 'Publish test results'
  condition: always()  # Run even if tests failed
  inputs:
    targetPath: 'test-results'
    artifactName: 'playwright-test-results'

- task: PublishPipelineArtifact@1
  displayName: 'Publish HTML report'
  condition: always()
  inputs:
    targetPath: 'playwright-report'
    artifactName: 'playwright-html-report'
```

 **After (GitHub Actions):**
```yaml
- name: Run Playwright tests
  run: npx playwright test
  continue-on-error: true

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-test-results
    path: test-results/
    retention-days: 30

- name: Upload HTML report
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-html-report
    path: playwright-report/
    retention-days: 30
```

### Pattern 11: Fix Debugging Black Hole (PW-INSIGHT-008)

 **Before:**
```typescript
// playwright.config.ts
export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  // No trace!
  // No video!
  // CI doesn't publish artifacts!
  // = Debugging black hole
});
```

 **After:**
```typescript
// playwright.config.ts
export default defineConfig({
  retries: process.env.CI ? 1 : 0, // Reduce retries

  use: {
    // Capture trace only when needed
    trace: 'on-first-retry', // or 'retain-on-failure'

    // Capture video on retry
    video: 'on-first-retry',

    // Ensure screenshots are taken
    screenshot: 'only-on-failure',
  },
});
```

**And in CI (see Pattern 10 above):**
- Publish test-results folder with `condition: always()`
- Set retention policy (e.g., 30 days)
- Ensure artifact URLs are visible in build summary

### Pattern 12: Add Test Isolation Hooks (PW-STABILITY-001)

 **Before:**
```typescript
// user-profile.spec.ts
import { test, expect } from '@playwright/test';

test('should update username', async ({ page }) => {
  await page.goto('/profile');
  await page.fill('#username', 'newname');
  await page.click('#save');
  // Cookies, localStorage persist to next test!
});

test('should update email', async ({ page }) => {
  // Still logged in from previous test
  // Has previous username in state
  await page.goto('/profile');
  await page.fill('#email', 'new@email.com');
  await page.click('#save');
  // Fails if first test failed!
});

test('should change password', async ({ page }) => {
  // Even more polluted state...
});
```

 **After:**
```typescript
// user-profile.spec.ts
import { test, expect } from '@playwright/test';

test.describe('User Profile', () => {
  test.beforeEach(async ({ page }) => {
    // Fresh state for every test
    await page.goto('/login');
    await page.fill('#username', 'testuser');
    await page.fill('#password', 'testpass');
    await page.click('#login-btn');
    await page.waitForURL('/dashboard');
  });

  test.afterEach(async ({ page }) => {
    // Clean up after each test
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
  });

  test('should update username', async ({ page }) => {
    await page.goto('/profile');
    await page.fill('#username', 'newname');
    await page.click('#save');
    await expect(page.locator('.success')).toBeVisible();
  });

  test('should update email', async ({ page }) => {
    // Clean state guaranteed by beforeEach
    await page.goto('/profile');
    await page.fill('#email', 'new@email.com');
    await page.click('#save');
    await expect(page.locator('.success')).toBeVisible();
  });

  test('should change password', async ({ page }) => {
    // Independent of other tests
    await page.goto('/profile');
    await page.fill('#current-password', 'testpass');
    await page.fill('#new-password', 'newpass');
    await page.click('#save');
    await expect(page.locator('.success')).toBeVisible();
  });
});
```

**Benefits:**
- Each test starts with clean state
- Failures don't cascade
- Tests can run in any order
- Retries work reliably

### Pattern 13: Organize Tests with Describe Blocks (PW-STABILITY-002)

 **Before:**
```typescript
// checkout.spec.ts - 25 tests, no organization
test('guest checkout works', ...);
test('logged in checkout works', ...);
test('invalid card shows error', ...);
test('expired card shows error', ...);
test('apply promo code', ...);
test('remove promo code', ...);
test('add gift message', ...);
test('change shipping address', ...);
test('change billing address', ...);
// ... 16 more tests
// Hard to know what failed when you see "checkout.spec.ts:142"
```

 **After:**
```typescript
// checkout.spec.ts - organized by feature
import { test, expect } from '@playwright/test';

test.describe('Checkout Flow', () => {
  test.describe('Guest Checkout', () => {
    test('should complete checkout without account', async ({ page }) => {
      // ...
    });

    test('should create account during checkout', async ({ page }) => {
      // ...
    });
  });

  test.describe('Logged In Checkout', () => {
    test('should use saved payment method', async ({ page }) => {
      // ...
    });

    test('should use saved shipping address', async ({ page }) => {
      // ...
    });
  });

  test.describe('Payment Validation', () => {
    test('should reject invalid card number', async ({ page }) => {
      // ...
    });

    test('should reject expired card', async ({ page }) => {
      // ...
    });

    test('should show CVV required error', async ({ page }) => {
      // ...
    });
  });

  test.describe('Promo Codes', () => {
    test('should apply valid promo code', async ({ page }) => {
      // ...
    });

    test('should show error for invalid code', async ({ page }) => {
      // ...
    });

    test('should remove promo code', async ({ page }) => {
      // ...
    });
  });

  test.describe('Address Management', () => {
    test('should change shipping address', async ({ page }) => {
      // ...
    });

    test('should change billing address', async ({ page }) => {
      // ...
    });
  });
});
```

**Benefits:**
- Clear test structure in reports
- Easy to run subsets: `npx playwright test --grep "Payment Validation"`
- Better failure context: "Checkout Flow > Payment Validation > should reject expired card"
- Shared setup per group with nested beforeEach hooks
- Easier code review and maintenance

### Pattern 14: POM Composition with Fixtures (ARCH-001)

> **Note:** Playwright's fixture-first philosophy recommends fixtures for shared setup logic. Class inheritance (BasePage) is still acceptable, but fixtures are preferred.

 **Approach A: Fixtures (recommended per Playwright docs):**
```typescript
// fixtures.ts
import { test as base, Page } from '@playwright/test';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

type MyFixtures = {
  loginPage: LoginPage;
  dashboardPage: DashboardPage;
};

export const test = base.extend<MyFixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  dashboardPage: async ({ page }, use) => {
    await use(new DashboardPage(page));
  },
});

// In tests:
test('should show dashboard', async ({ loginPage, dashboardPage }) => {
  await loginPage.login('user', 'pass');
  await dashboardPage.expectWelcomeMessage();
});
```

 **Approach B: BasePage inheritance (still valid):**
```typescript
// pages/BasePage.ts
export abstract class BasePage {
  constructor(protected page: Page) {}

  async waitForLoad() {
    await this.page.waitForLoadState('domcontentloaded');
  }
}

// pages/LoginPage.ts
export class LoginPage extends BasePage {
  async login(user: string, pass: string) {
    await this.page.fill('#username', user);
    await this.page.fill('#password', pass);
    await this.page.locator('#submit').click();
  }
}
```

### Pattern 15: Encapsulate Complex Interactions (ARCH-002)

> **Note:** Playwright's official POM example uses `public readonly` locators, which is acceptable. Encapsulation is most valuable for complex multi-step interactions.

 **Simple locators — public readonly is fine (per Playwright docs):**
```typescript
export class ProductPage {
  // Public readonly locators — acceptable per Playwright POM docs
  readonly addToCartButton = this.page.locator('[data-testid="add-to-cart"]');
  readonly quantity = this.page.locator('#quantity');
  readonly price = this.page.locator('.price');

  constructor(private page: Page) {}
}
```

 **Complex interactions — wrap in semantic methods:**
```typescript
export class ProductPage {
  readonly price = this.page.locator('.price');  // simple: keep public
  private addToCartButton = this.page.locator('[data-testid="add-to-cart"]');
  private quantityInput = this.page.locator('#quantity');

  constructor(private page: Page) {}

  // Complex multi-step: encapsulate
  async addToCart(quantity: number = 1) {
    await this.quantityInput.fill(String(quantity));
    await this.addToCartButton.click();
    await this.page.waitForResponse(/\/api\/cart/);
  }
}
```

### Pattern 16: Fix Test Coupling (ARCH-003)

 **Before:**
```typescript
// tests/login.spec.ts
export const testUser = { email: 'test@example.com', pass: 'test123' };

export async function loginHelper(page: Page) {
  await page.fill('#email', testUser.email);
  await page.fill('#password', testUser.pass);
  await page.click('#submit');
}

// tests/dashboard.spec.ts - importing from another test file!
import { loginHelper, testUser } from './login.spec';

test('dashboard shows user name', async ({ page }) => {
  await loginHelper(page);  // Tight coupling!
});
```

 **After:**
```typescript
// utils/test-helpers.ts - dedicated helper file
export const testUser = { email: 'test@example.com', pass: 'test123' };

export async function loginHelper(page: Page) {
  await page.fill('#email', testUser.email);
  await page.fill('#password', testUser.pass);
  await page.click('#submit');
}

// tests/dashboard.spec.ts
import { loginHelper } from '../utils/test-helpers';

test('dashboard shows user name', async ({ page }) => {
  await loginHelper(page);  // Clean import from utility
});
```

### Pattern 17: Type Fixtures Properly (ARCH-004)

 **Before:**
```typescript
// fixtures.ts
export const test = base.extend({
  apiClient: async ({}, use: any) => {
    const client = createApiClient();
    await use(client);  // No type safety!
  },

  testUser: async ({}, use: any) => {
    await use({ name: 'test', email: 'test@example.com' });
  }
});
```

 **After:**
```typescript
// fixtures.ts
type TestFixtures = {
  apiClient: ApiClient;
  testUser: { name: string; email: string; id?: string };
};

export const test = base.extend<TestFixtures>({
  apiClient: async ({}, use) => {
    const client = createApiClient();
    await use(client);  // TypeScript knows the type!
  },

  testUser: async ({}, use) => {
    await use({ name: 'test', email: 'test@example.com' });
  }
});

// In tests - full autocomplete and type checking
test('create order', async ({ apiClient, testUser }) => {
  const order = await apiClient.createOrder(testUser.id!);  // TS error if wrong type
});
```

### Pattern 18: Use Environment Variables for Credentials (ARCH-005)

  **Before:**
```typescript
// tests/api.spec.ts
const API_KEY = 'sk_live_abc123xyz789';  // Security risk!
const TEST_PASSWORD = 'SuperSecret123';   // Hardcoded!

test('authenticate', async ({ request }) => {
  await request.post('/api/auth', {
    headers: { 'X-API-Key': API_KEY },
    data: { password: TEST_PASSWORD }
  });
});
```

  **After:**
```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    extraHTTPHeaders: {
      'X-API-Key': process.env.API_KEY ?? '',
    }
  }
});

// tests/api.spec.ts
test('authenticate', async ({ request }) => {
  await request.post('/api/auth', {
    data: { password: process.env.TEST_PASSWORD }
  });
});

// CI pipeline (Azure/GitHub) sets the secrets
// - API_KEY from Key Vault / Secrets
// - TEST_PASSWORD from Key Vault / Secrets
```

### Pattern 19: Add API Mocking (ARCH-006)

 **Before:**
```typescript
test('shows error on API failure', async ({ page }) => {
  // Can't reliably test error states without mocking
  await page.goto('/dashboard');
  // How do we test when /api/data fails?
});
```

 **After:**
```typescript
test('shows error on API failure', async ({ page }) => {
  // Mock the API to return an error
  await page.route('**/api/data', route => {
    route.fulfill({
      status: 500,
      body: JSON.stringify({ error: 'Internal Server Error' })
    });
  });

  await page.goto('/dashboard');
  await expect(page.locator('.error-message')).toContainText('Something went wrong');
});

test('handles slow responses gracefully', async ({ page }) => {
  await page.route('**/api/data', async route => {
    await new Promise(r => setTimeout(r, 5000));  // Simulate slow response
    route.fulfill({ body: JSON.stringify({ data: [] }) });
  });

  await page.goto('/dashboard');
  await expect(page.locator('.loading-spinner')).toBeVisible();
});
```

### Pattern 20: Migrate Deprecated APIs (PW-DEPREC-001 to 008)

 **Before (deprecated selector engine):**
```typescript
// PW-DEPREC-001: Deprecated $, $$, $eval, $$eval
const button = await page.$('button.submit');
await button?.click();
const items = await page.$$('.item');
const text = await page.$eval('.title', el => el.textContent);
```

 **After (modern locator API):**
```typescript
await page.locator('button.submit').click();
const items = page.locator('.item');
const text = await page.locator('.title').textContent();
```

 **Before (deprecated page convenience methods):**
```typescript
// PW-DEPREC-002: Deprecated page.action(selector)
await page.click('button.submit');
await page.fill('input[name="email"]', 'test@example.com');
await page.type('input[name="search"]', 'hello');
await page.hover('.nav-link');
await page.check('input[type="checkbox"]');
await page.selectOption('select#country', 'US');
const name = await page.getAttribute('.user', 'data-name');
const visible = await page.isVisible('.dashboard');
```

 **After:**
```typescript
await page.locator('button.submit').click();
await page.locator('input[name="email"]').fill('test@example.com');
await page.locator('input[name="search"]').pressSequentially('hello');
await page.locator('.nav-link').hover();
await page.locator('input[type="checkbox"]').check();
await page.locator('select#country').selectOption('US');
const name = await page.locator('.user').getAttribute('data-name');
const visible = await page.locator('.dashboard').isVisible();
```

 **Before (deprecated wait methods):**
```typescript
// PW-DEPREC-003: Deprecated waitForNavigation / waitForSelector
await page.click('a.login');
await page.waitForNavigation();
await page.waitForSelector('.dashboard');
```

 **After:**
```typescript
await page.locator('a.login').click();
await page.waitForURL('**/dashboard');
await page.locator('.dashboard').waitFor();
```

 **Before (deprecated test runner APIs):**
```typescript
// PW-DEPREC-004: test.describe.serial (isolation risk)
test.describe.serial('my serial tests', () => { ... });
```

 **After:**
```typescript
// Preferred: make tests fully isolated so serial isn't needed
test.describe('my tests', () => { ... });

// If serial is truly required (e.g., multi-step wizard):
test.describe('my serial tests', () => {
  test.describe.configure({ mode: 'serial' });
  ...
});
```

 **Before (deprecated type method):**
```typescript
// PW-DEPREC-007: page.type() deprecated in v1.39
await page.type('#search', 'hello world');
await locator.type('hello world');
```

 **After:**
```typescript
// Use fill() for setting value (fast)
await page.locator('#search').fill('hello world');
// Use pressSequentially() only when key events matter
await page.locator('#search').pressSequentially('hello world');
```

 **Before (deprecated layout selectors):**
```typescript
// PW-DEPREC-008: Layout selectors deprecated
await page.locator('button:right-of(#search)').click();
await page.locator('div:below(.header)').first();
```

 **After:**
```typescript
// Use semantic locators or filter()
await page.getByRole('button', { name: 'Search' }).click();
await page.locator('div').filter({ hasText: 'content' }).first();
```

 **Before (deprecated config):**
```typescript
// PW-DEPREC-005: Deprecated snapshotDir
export default defineConfig({
  snapshotDir: './snapshots',
});
```

 **After:**
```typescript
export default defineConfig({
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}',
});
```

### Pattern 21: Use Web-First Assertions (PW-FLAKE-005)

 **Before (non-retrying — flaky):**
```typescript
// These don't retry — if timing is off, they fail
expect(await locator.isVisible()).toBe(true);
expect(await locator.textContent()).toBe('Welcome');
expect(await page.title()).toBe('Dashboard');
expect(await locator.getAttribute('class')).toContain('active');
```

 **After (web-first — auto-retrying):**
```typescript
// These automatically retry until condition is met or timeout
await expect(locator).toBeVisible();
await expect(locator).toHaveText('Welcome');
await expect(page).toHaveTitle('Dashboard');
await expect(locator).toHaveAttribute('class', /active/);
```

### Pattern 22: Configure forbidOnly (PW-INSIGHT-014)

```typescript
// playwright.config.ts
export default defineConfig({
  forbidOnly: !!process.env.CI, // Fail CI if test.only() is left in
  // ...
});
```

### Pattern 23: CI-Conditional Retries (PW-INSIGHT-015)

```typescript
// playwright.config.ts
export default defineConfig({
  retries: process.env.CI ? 2 : 0, // Only retry in CI — fail fast locally
  // ...
});
```

### Pattern 24: Clean Up Browser Resources (PW-STABILITY-005, SE-STABILITY-001)

 **Before (Playwright — resource leak):**
```typescript
test('custom browser context', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/app');
  // browser never closed — leaks!
});
```

 **After (Playwright — proper cleanup):**
```typescript
test.describe('Custom browser tests', () => {
  let browser: Browser;

  test.beforeAll(async () => {
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    await browser.close(); // Always clean up
  });

  test('custom browser context', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/app');
    await context.close(); // Clean up context too
  });
});
```

 **Better: Use Playwright's built-in fixtures instead of manual browser management.**

## Typical Audit Workflow

1. **Run audit** — Generate audit_summary.md
2. **Read Executive Summary** — Understand health score and grade
3. **Follow Top 3 Actions** — Start with highest impact
4. **Address High Findings** — Fix flakiness issues first
5. **Migrate Deprecated APIs** — Update to modern Playwright APIs (PW-DEPREC-\*)
6. **Configure CI** — Ensure reports/artifacts are published
7. **Address Medium Findings** — Quality of life improvements
8. **Re-run audit** — Validate improvements
9. **Track over time** — Health score should increase toward 100

## Health Score Interpretation

Scantrix uses a **0–100 health score** where **higher is better**, similar to Google Lighthouse. The score is computed from raw risk points using exponential decay: `healthScore = round(100 × exp(-riskPoints / 80))`.

| Health Score | Grade | Level | Action |
|---|---|---|---|
| 80–100 | A | Excellent | Maintain current quality |
| 50–79 | B | Good | Schedule minor improvements |
| 30–49 | C | Fair | Prioritize remediation |
| 15–29 | D | Poor | Serious issues, prioritize immediately |
| 0–14 | F | Critical | Systemic issues across the framework |

### Score Calculation

```
Step 1: Accumulate risk points

  riskPoints = Σ (basePoints × evidenceMultiplier × categoryMultiplier)

  basePoints (severity):
    high = 3, medium = 2, low = 1

  evidenceMultiplier:
    min(1 + log₂(evidenceCount), 3.5)   // log-scale, capped at 3.5×

  categoryMultiplier:
    PW-INSIGHT-* = 1.5×   (correlated findings)
    CI-*         = 1.3×   (CI pipeline impact)
    ARCH-*       = 1.2×   (architecture debt)
    all others   = 1.0×

Step 2: Convert to health score

  healthScore = round(100 × exp(-riskPoints / 80))
```

### Example Conversions

| Risk Points | Health Score | Grade |
|---|---|---|
| 0 | 100 | A |
| 10 | 88 | A |
| 20 | 78 | B |
| 50 | 54 | B |
| 85 | 35 | C |
| 120 | 22 | D |
| 164 | 13 | F |

### Worked Example

```
Findings:
  - 25 hard waits (PW-FLAKE-001, high):  3 × min(1 + log₂(25), 3.5) × 1.0 = 3 × 3.5 × 1.0 = 10.5
  - 3 force clicks (PW-FLAKE-002, med):   2 × min(1 + log₂(3), 3.5) × 1.0  = 2 × 2.58 × 1.0 = 5.2
  - 1 masked flakiness (PW-INSIGHT-001):  3 × 1.0 × 1.5                     = 4.5

  riskPoints ≈ 20.2
  healthScore = round(100 × exp(-20.2 / 80)) = round(100 × 0.777) = 78 (Grade B)
```
