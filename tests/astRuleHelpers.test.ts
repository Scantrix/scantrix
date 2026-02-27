import { describe, it, expect } from "vitest";
import {
  findVariableShadowing,
  findCustomAssertionWrappers,
  findManualContextInTestBodies,
  findTestDataMutations,
} from "../src/astRuleHelpers";

// ─── PW-STABILITY-007: Variable Shadowing ────────────────────────────

describe("findVariableShadowing", () => {
  it("detects let shadowed by const inside test()", () => {
    const source = `
import { test, expect } from '@playwright/test';
test.describe('suite', () => {
  let myVar: any;
  test('case', async () => {
    const myVar = 'hello';
  });
});`;
    const results = findVariableShadowing("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("myVar");
    expect(results[0].outerKind).toBe("let");
    expect(results[0].innerKind).toBe("const");
  });

  it("detects multiple shadowed variables", () => {
    const source = `
import { test } from '@playwright/test';
test.describe('suite', () => {
  let alpha: any;
  let beta: any;
  test('case', async () => {
    const alpha = 1;
    const beta = 2;
  });
});`;
    const results = findVariableShadowing("test.spec.ts", source);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name).sort()).toEqual(["alpha", "beta"]);
  });

  it("ignores const outer declarations (not shadowable in practice)", () => {
    const source = `
import { test } from '@playwright/test';
test.describe('suite', () => {
  const myConst = 'fixed';
  test('case', async () => {
    const myConst = 'different';
  });
});`;
    const results = findVariableShadowing("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("ignores variables prefixed with underscore", () => {
    const source = `
import { test } from '@playwright/test';
test.describe('suite', () => {
  let _unused: any;
  test('case', async () => {
    const _unused = 'val';
  });
});`;
    const results = findVariableShadowing("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("returns empty for files without test.describe", () => {
    const source = `
import { test } from '@playwright/test';
test('standalone', async ({ page }) => {
  const x = 1;
});`;
    const results = findVariableShadowing("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("detects shadowing inside hooks (beforeAll/afterAll)", () => {
    const source = `
import { test } from '@playwright/test';
test.describe('suite', () => {
  let ctx: any;
  test.beforeAll(async () => {
    const ctx = 'new';
  });
});`;
    const results = findVariableShadowing("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("ctx");
  });
});

// ─── PW-FLAKE-007: Custom Assertion Wrappers ─────────────────────────

describe("findCustomAssertionWrappers", () => {
  it("detects assertion-like imports used more than expect()", () => {
    const source = `
import { test } from '@playwright/test';
import { compareResults } from '../utils/assertions';

test('a', async () => { await compareResults('a', 'a'); });
test('b', async () => { await compareResults('b', 'b'); });
test('c', async () => { await compareResults('c', 'c'); });
`;
    const results = findCustomAssertionWrappers("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].importName).toBe("compareResults");
    expect(results[0].callCount).toBe(3);
    expect(results[0].expectCount).toBe(0);
  });

  it("does not flag when expect() covers all tests", () => {
    const source = `
import { test, expect } from '@playwright/test';
import { compareResults } from '../utils/assertions';

test('a', async ({ page }) => {
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('h2')).toBeVisible();
  await expect(page.locator('h3')).toBeVisible();
});
`;
    // 1 test, 3 expect calls, 0 custom calls → no flag
    const results = findCustomAssertionWrappers("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does not flag non-relative imports", () => {
    const source = `
import { test } from '@playwright/test';
import { assert } from 'chai';

test('a', async () => { assert.equal(1, 1); });
test('b', async () => { assert.equal(2, 2); });
test('c', async () => { assert.equal(3, 3); });
`;
    const results = findCustomAssertionWrappers("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("requires at least 2 calls to flag", () => {
    const source = `
import { test } from '@playwright/test';
import { verifyState } from '../utils/helpers';

test('a', async () => { await verifyState('active'); });
`;
    const results = findCustomAssertionWrappers("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });
});

// ─── PW-STABILITY-008: Manual Browser Context ───────────────────────

describe("findManualContextInTestBodies", () => {
  it("detects browser.newContext() inside test()", () => {
    const source = `
import { test, expect } from '@playwright/test';

test('manual context', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: './auth.json' });
  const page = await ctx.newPage();
  await page.goto('/');
});
`;
    const results = findManualContextInTestBodies("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("manual context");
    expect(results[0].count).toBe(1);
  });

  it("counts multiple newContext calls in one test", () => {
    const source = `
import { test } from '@playwright/test';

test('multi-context', async ({ browser }) => {
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
});
`;
    const results = findManualContextInTestBodies("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].count).toBe(2);
  });

  it("skips hooks (beforeAll/afterAll)", () => {
    const source = `
import { test } from '@playwright/test';

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
});
`;
    const results = findManualContextInTestBodies("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("returns empty when no newContext calls exist", () => {
    const source = `
import { test, expect } from '@playwright/test';

test('clean test', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
});
`;
    const results = findManualContextInTestBodies("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });
});

// ─── ARCH-012: Mutating Imported Test Data ───────────────────────────

describe("findTestDataMutations", () => {
  it("detects property assignment on namespace imports", () => {
    const source = `
import * as testData from '../test-data/assets';

testData.payload.CustomerId = '123';
testData.payload.Name = 'Modified';
`;
    const results = findTestDataMutations("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].bindingName).toBe("testData");
    expect(results[0].mutationCount).toBe(2);
  });

  it("detects mutations on named imports from data-like paths", () => {
    const source = `
import { config } from '../test-data/config';

config.baseUrl = 'http://localhost';
`;
    const results = findTestDataMutations("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].bindingName).toBe("config");
  });

  it("ignores non-relative imports", () => {
    const source = `
import * as lodash from 'lodash';

lodash.something = 'test';
`;
    const results = findTestDataMutations("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("ignores comparison operators (===, ==)", () => {
    const source = `
import * as testData from '../test-data/values';

if (testData.value === 'expected') {
  console.log('match');
}
`;
    const results = findTestDataMutations("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("returns empty for files without imports", () => {
    const source = `
const x = 1;
x = 2;
`;
    const results = findTestDataMutations("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });
});
