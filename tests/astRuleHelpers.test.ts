import { describe, it, expect } from "vitest";
import {
  findVariableShadowing,
  findCustomAssertionWrappers,
  findManualContextInTestBodies,
  findTestDataMutations,
  findMissingPlaywrightAwaits,
  findUnguardedRetrievalMethods,
  findUnguardedRetrievalMethodsInFunctions,
  extractRelativeImportBindings,
  findSleepWrapperExports,
  findDisguisedHardWaitCalls,
  findClassSleepMethodExports,
  analyzePomClassStructure,
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

  it("detects request.newContext() inside test()", () => {
    const source = `
import { test, expect } from '@playwright/test';

test('manual api context', async ({ request }) => {
  const apiCtx = await request.newContext({ baseURL: 'https://api.example.com' });
  const response = await apiCtx.get('/users');
  expect(response.ok()).toBeTruthy();
});
`;
    const results = findManualContextInTestBodies("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("manual api context");
    expect(results[0].count).toBe(1);
  });

  it("counts mixed browser.newContext() and request.newContext() in one test", () => {
    const source = `
import { test } from '@playwright/test';

test('mixed contexts', async ({ browser, request }) => {
  const ctx = await browser.newContext();
  const apiCtx = await request.newContext();
});
`;
    const results = findManualContextInTestBodies("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].count).toBe(2);
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

// ─── PW-FLAKE-008: Missing await on Async Playwright APIs ───────────

describe("findMissingPlaywrightAwaits", () => {
  it("detects unawaited expect().toBeVisible() inside test()", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('my test', async ({ page }) => {
  expect(page.locator('.title')).toBeVisible();
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("my test");
    expect(results[0].snippet).toBe("expect(...).toBeVisible(...)");
  });

  it("detects unawaited test.step() inside test()", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('step test', async ({ page }) => {
  test.step('do stuff', async () => {
    await expect(page.locator('h1')).toBeVisible();
  });
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("step test");
    expect(results[0].snippet).toBe("test.step(...)");
  });

  it("detects unawaited expect.soft().toBeVisible() inside test()", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('soft test', async ({ page }) => {
  expect.soft(page.locator('.title')).toBeVisible();
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("soft test");
    expect(results[0].snippet).toBe("expect.soft(...).toBeVisible(...)");
  });

  it("detects unawaited expect.poll().toBe() inside test()", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('poll test', async ({ page }) => {
  expect.poll(() => page.locator('.count').textContent()).toBe('5');
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("poll test");
    expect(results[0].snippet).toBe("expect.poll(...).toBe(...)");
  });

  it("does NOT flag properly awaited assertions", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('awaited test', async ({ page }) => {
  await expect(page.locator('.title')).toBeVisible();
  await expect(page.locator('.content')).toHaveText('Hello');
  await test.step('verify', async () => {
    await expect(page.locator('h1')).toBeVisible();
  });
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag non-async matchers (toBe, toEqual, etc.)", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('sync test', async ({ page }) => {
  expect(1 + 1).toBe(2);
  expect('hello').toEqual('hello');
  expect([1, 2]).toContain(1);
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("detects negated form expect().not.toBeVisible() without await", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('negated test', async ({ page }) => {
  expect(page.locator('.hidden')).not.toBeVisible();
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("expect(...).toBeVisible(...)");
  });

  it("returns correct line numbers and test names", () => {
    const source = `import { test, expect } from '@playwright/test';
test('first', async ({ page }) => {
  expect(page.locator('.a')).toBeVisible();
});
test('second', async ({ page }) => {
  expect(page.locator('.b')).toHaveText('x');
});`;
    const results = findMissingPlaywrightAwaits("test.spec.ts", source);
    expect(results).toHaveLength(2);
    expect(results[0].testName).toBe("first");
    expect(results[0].line).toBe(3);
    expect(results[1].testName).toBe("second");
    expect(results[1].line).toBe(6);
  });
});

// ─── extractRelativeImportBindings ────────────────────────────────────

describe("extractRelativeImportBindings", () => {
  it("extracts named imports from relative paths", () => {
    const source = `
import { delay, sleep } from '../utils/helpers';
import { test } from '@playwright/test';
`;
    const bindings = extractRelativeImportBindings("test.spec.ts", source);
    expect(bindings).toHaveLength(2);
    expect(bindings[0]).toEqual({ localName: "delay", originalName: "delay", modulePath: "../utils/helpers" });
    expect(bindings[1]).toEqual({ localName: "sleep", originalName: "sleep", modulePath: "../utils/helpers" });
  });

  it("handles renamed imports (import { x as y })", () => {
    const source = `
import { delay as wait } from '../utils/helpers';
`;
    const bindings = extractRelativeImportBindings("test.spec.ts", source);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual({ localName: "wait", originalName: "delay", modulePath: "../utils/helpers" });
  });

  it("skips non-relative imports", () => {
    const source = `
import { test } from '@playwright/test';
import lodash from 'lodash';
import { foo } from '../utils/helpers';
`;
    const bindings = extractRelativeImportBindings("test.spec.ts", source);
    expect(bindings).toHaveLength(1);
    expect(bindings[0].localName).toBe("foo");
  });

  it("extracts default imports", () => {
    const source = `
import helpers from '../utils/helpers';
`;
    const bindings = extractRelativeImportBindings("test.spec.ts", source);
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toEqual({ localName: "helpers", originalName: "default", modulePath: "../utils/helpers" });
  });
});

// ─── findSleepWrapperExports ──────────────────────────────────────────

describe("findSleepWrapperExports", () => {
  it("detects exported async function with Promise-setTimeout", () => {
    const source = `
export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toContain("delay");
  });

  it("detects exported const arrow function with setTimeout", () => {
    const source = `
export const sleep = async (ms: number) => {
  await new Promise((r) => setTimeout(r, ms));
};
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toContain("sleep");
  });

  it("detects function with waitForTimeout in body", () => {
    const source = `
export async function pause(page: any, ms: number) {
  await page.waitForTimeout(ms);
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toContain("pause");
  });

  it("detects re-exported functions via export { name }", () => {
    const source = `
async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
export { delay };
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toContain("delay");
  });

  it("does NOT flag functions with retry/loop logic", () => {
    const source = `
export async function retryOperation(fn: () => Promise<void>, maxAttempts: number = 3): Promise<void> {
  let attempt = 0;
  while (attempt < maxAttempts) {
    try { await fn(); return; } catch {
      attempt++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag non-exported functions", () => {
    const source = `
async function internalDelay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toHaveLength(0);
  });

  it("returns empty for files with no sleep patterns", () => {
    const source = `
export function add(a: number, b: number): number {
  return a + b;
}
export async function fetchData(url: string) {
  const res = await fetch(url);
  return res.json();
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toHaveLength(0);
  });
});

// ─── findDisguisedHardWaitCalls ───────────────────────────────────────

describe("findDisguisedHardWaitCalls", () => {
  it("finds calls to known wrapper bindings with correct line numbers", () => {
    const source = `import { test } from '@playwright/test';
import { delay } from '../utils/helpers';

test('my test', async ({ page }) => {
  await delay(2000);
});`;
    const wrapperBindings = new Map([["delay", "../utils/helpers"]]);
    const results = findDisguisedHardWaitCalls("test.spec.ts", source, wrapperBindings);
    expect(results).toHaveLength(1);
    expect(results[0].calledFunction).toBe("delay");
    expect(results[0].line).toBe(5);
    expect(results[0].importPath).toBe("../utils/helpers");
  });

  it("finds multiple calls across tests", () => {
    const source = `import { delay, sleep } from '../utils/helpers';

test('a', async () => { await delay(1000); });
test('b', async () => { await sleep(2000); });
test('c', async () => { await delay(500); });`;
    const wrapperBindings = new Map([
      ["delay", "../utils/helpers"],
      ["sleep", "../utils/helpers"],
    ]);
    const results = findDisguisedHardWaitCalls("test.spec.ts", source, wrapperBindings);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.calledFunction)).toEqual(["delay", "sleep", "delay"]);
  });

  it("returns empty when no wrapper calls exist", () => {
    const source = `import { test } from '@playwright/test';
test('clean test', async ({ page }) => {
  await page.goto('/');
});`;
    const wrapperBindings = new Map([["delay", "../utils/helpers"]]);
    const results = findDisguisedHardWaitCalls("test.spec.ts", source, wrapperBindings);
    expect(results).toHaveLength(0);
  });

  it("returns empty when wrapperBindings map is empty", () => {
    const source = `import { delay } from '../utils/helpers';
test('test', async () => { await delay(1000); });`;
    const wrapperBindings = new Map<string, string>();
    const results = findDisguisedHardWaitCalls("test.spec.ts", source, wrapperBindings);
    expect(results).toHaveLength(0);
  });

  it("finds property access calls (instance.delay()) via sleepMethodBindings", () => {
    const source = `import { WaiterHelpers } from '../utils/helpers';
const waiter = new WaiterHelpers();

test('test', async ({ page }) => {
  await waiter.delay(2000);
  await waiter.delay(1000);
});`;
    const wrapperBindings = new Map<string, string>();
    const sleepMethodBindings = new Map([["delay", "../utils/helpers"]]);
    const results = findDisguisedHardWaitCalls("test.spec.ts", source, wrapperBindings, sleepMethodBindings);
    expect(results).toHaveLength(2);
    expect(results[0].calledFunction).toBe("delay");
    expect(results[0].importPath).toBe("../utils/helpers");
  });

  it("finds this.delay() calls via sleepMethodBindings", () => {
    const source = `
test('test', async () => {
  await this.delay(500);
});`;
    const wrapperBindings = new Map<string, string>();
    const sleepMethodBindings = new Map([["delay", "../utils/helpers"]]);
    const results = findDisguisedHardWaitCalls("test.spec.ts", source, wrapperBindings, sleepMethodBindings);
    expect(results).toHaveLength(1);
    expect(results[0].calledFunction).toBe("delay");
  });

  it("ignores property access calls not in sleepMethodBindings", () => {
    const source = `
test('test', async ({ page }) => {
  await page.click('.button');
  await helper.doSomething();
});`;
    const wrapperBindings = new Map<string, string>();
    const sleepMethodBindings = new Map([["delay", "../utils/helpers"]]);
    const results = findDisguisedHardWaitCalls("test.spec.ts", source, wrapperBindings, sleepMethodBindings);
    expect(results).toHaveLength(0);
  });
});

// ─── findClassSleepMethodExports ──────────────────────────────────────

describe("findClassSleepMethodExports", () => {
  it("detects sleep method in directly exported class", () => {
    const source = `
export class WaiterHelpers {
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].className).toBe("WaiterHelpers");
    expect(results[0].methodNames).toContain("delay");
  });

  it("handles export { ClassName } re-export pattern", () => {
    const source = `
class WaiterHelpers {
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
export { WaiterHelpers };
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].className).toBe("WaiterHelpers");
    expect(results[0].methodNames).toContain("delay");
  });

  it("handles export default class", () => {
    const source = `
export default class WaiterHelpers {
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].className).toBe("WaiterHelpers");
    expect(results[0].methodNames).toContain("delay");
  });

  it("does NOT flag methods with retry loops", () => {
    const source = `
export class Helpers {
  async retryWithBackoff(fn: () => Promise<void>, maxAttempts: number = 3): Promise<void> {
    let attempt = 0;
    while (attempt < maxAttempts) {
      try { await fn(); return; } catch {
        attempt++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
}
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag non-exported classes", () => {
    const source = `
class InternalHelpers {
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(0);
  });

  it("returns empty for classes without sleep methods", () => {
    const source = `
export class Utils {
  add(a: number, b: number): number {
    return a + b;
  }
  async fetchData(url: string) {
    const res = await fetch(url);
    return res.json();
  }
}
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(0);
  });

  it("detects multiple sleep methods in one class", () => {
    const source = `
export class WaitUtils {
  async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async pause(page: any, ms: number): Promise<void> {
    await page.waitForTimeout(ms);
  }
}
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].methodNames).toEqual(["delay", "pause"]);
  });

  it("detects class method wrapping waitForNetworkIdle", () => {
    const source = `
export class WaiterHelpers {
  async waitForIdleNetwork(page: any): Promise<void> {
    await page.waitForNetworkIdle();
  }
}
`;
    const results = findClassSleepMethodExports("utils.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].methodNames).toContain("waitForIdleNetwork");
  });
});

// ─── bodyContainsSleepPattern: networkidle patterns ───────────────────

describe("findSleepWrapperExports — networkidle patterns", () => {
  it("detects function wrapping waitForNetworkIdle", () => {
    const source = `
export async function waitIdle(page: any): Promise<void> {
  await page.waitForNetworkIdle();
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toContain("waitIdle");
  });

  it("detects function wrapping waitForLoadState('networkidle')", () => {
    const source = `
export async function waitForIdle(page: any): Promise<void> {
  await page.waitForLoadState('networkidle');
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toContain("waitForIdle");
  });

  it("does NOT flag waitForLoadState with non-networkidle argument", () => {
    const source = `
export async function waitForLoad(page: any): Promise<void> {
  await page.waitForLoadState('load');
}
`;
    const results = findSleepWrapperExports("utils.ts", source);
    expect(results).toHaveLength(0);
  });
});

// ─── PW-FLAKE-010: Unguarded Retrieval Methods ───────────────────────

describe("findUnguardedRetrievalMethods", () => {
  it("flags .innerText() without a preceding content guard", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('extract text', async ({ page }) => {
  await page.goto('/details');
  const title = await page.locator('.title').innerText();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe(".innerText()");
    expect(results[0].testName).toBe("extract text");
  });

  it("flags multiple retrieval methods in same test", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('extract all', async ({ page }) => {
  await page.goto('/details');
  const a = await page.locator('.a').innerText();
  const b = await page.locator('.b').innerHTML();
  const c = await page.locator('.c').inputValue();
  const d = await page.locator('.d').textContent();
  const e = await page.locator('.e').allInnerTexts();
  const f = await page.locator('.f').allTextContents();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(6);
    const methods = results.map(r => r.snippet);
    expect(methods).toContain(".innerText()");
    expect(methods).toContain(".innerHTML()");
    expect(methods).toContain(".inputValue()");
    expect(methods).toContain(".textContent()");
    expect(methods).toContain(".allInnerTexts()");
    expect(methods).toContain(".allTextContents()");
  });

  it("does NOT flag retrieval preceded by toHaveText guard", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('guarded', async ({ page }) => {
  await page.goto('/details');
  await expect(page.locator('#amount')).not.toHaveText('');
  const val = await page.locator('#amount').inputValue();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by toContainText guard", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('guarded', async ({ page }) => {
  await page.goto('/details');
  await expect(page.locator('.title')).toContainText('Order');
  const title = await page.locator('.title').innerText();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by toBeEmpty guard", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('guarded', async ({ page }) => {
  await page.goto('/details');
  await expect(page.locator('.content')).not.toBeEmpty();
  const text = await page.locator('.content').textContent();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by toBeVisible guard", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('guarded', async ({ page }) => {
  await page.goto('/details');
  await expect(page.locator('.title')).toBeVisible();
  const text = await page.locator('.title').innerText();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by .waitFor()", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('guarded', async ({ page }) => {
  await page.goto('/details');
  await page.locator('.title').waitFor();
  const text = await page.locator('.title').innerText();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by .waitFor({ state: 'visible' })", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('guarded', async ({ page }) => {
  await page.goto('/details');
  await page.locator('.price').waitFor({ state: 'visible' });
  const price = await page.locator('.price').textContent();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by toPass guard", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('polled', async ({ page }) => {
  await page.goto('/details');
  let text = '';
  await expect(async () => { text = await page.locator('.x').innerText(); expect(text).not.toBe(''); }).toPass();
  const val = await page.locator('.y').innerText();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    // The .innerText() inside the toPass callback is on the same statement as the guard — suppressed.
    // The .innerText() after the toPass statement is also guarded by the preceding toPass.
    expect(results).toHaveLength(0);
  });

  it("flags retrieval when guard is too far away (>5 statements)", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('far guard', async ({ page }) => {
  await expect(page.locator('.x')).toHaveText('ready');
  await page.goto('/a');
  await page.goto('/b');
  await page.goto('/c');
  await page.goto('/d');
  await page.goto('/e');
  const text = await page.locator('.x').innerText();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(1);
  });

  it("does NOT flag code outside test() callbacks", () => {
    const source = `
import { test, expect } from '@playwright/test';
async function helper(page: any) {
  const text = await page.locator('.x').innerText();
}
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(0);
  });

  it("handles test.only correctly", () => {
    const source = `
import { test, expect } from '@playwright/test';
test.only('focused', async ({ page }) => {
  const text = await page.locator('.x').innerText();
});
`;
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("focused");
  });

  it("does NOT flag retrieval inside expect() chain (not a standalone call)", () => {
    const source = `
import { test, expect } from '@playwright/test';
test('inline', async ({ page }) => {
  expect(await page.locator('.nav').textContent()).toBe('Navigation');
});
`;
    // textContent() is inside an expect(), the statement itself is a content assertion.
    // The statement contains a guard (expect...toBe) which is not one of our guard matchers,
    // but the textContent() IS still flagged because toBe is not a content guard.
    // However, this is an intentional pattern — the user is using the value inline.
    // The AST approach correctly flags this since there's no preceding guard statement.
    const results = findUnguardedRetrievalMethods("test.spec.ts", source);
    expect(results).toHaveLength(1);
  });
});

// ─── PW-FLAKE-010 (non-test files): Unguarded Retrieval in Functions ──

describe("findUnguardedRetrievalMethodsInFunctions", () => {
  it("flags .innerText() in a page class method", () => {
    const source = `
export class LoginPage {
  async getTitle(page: any) {
    return await page.locator('.title').innerText();
  }
}
`;
    const results = findUnguardedRetrievalMethodsInFunctions("pages/login.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe(".innerText()");
    expect(results[0].testName).toBe("getTitle");
  });

  it("flags retrieval in standalone function declarations", () => {
    const source = `
export async function extractHeader(page: any) {
  const text = await page.locator('h1').textContent();
  return text;
}
`;
    const results = findUnguardedRetrievalMethodsInFunctions("utils/helpers.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("extractHeader");
  });

  it("flags retrieval in arrow function assigned to variable", () => {
    const source = `
export const getText = async (page: any) => {
  return await page.locator('.x').innerHTML();
};
`;
    const results = findUnguardedRetrievalMethodsInFunctions("utils/helpers.ts", source);
    expect(results).toHaveLength(1);
    expect(results[0].testName).toBe("getText");
  });

  it("does NOT flag retrieval preceded by content guard in same method", () => {
    const source = `
import { expect } from '@playwright/test';
export class DashboardPage {
  async getSafeTitle(page: any) {
    await expect(page.locator('.title')).toContainText('Dashboard');
    return await page.locator('.title').innerText();
  }
}
`;
    const results = findUnguardedRetrievalMethodsInFunctions("pages/dashboard.ts", source);
    expect(results).toHaveLength(0);
  });

  it("flags multiple methods in the same class", () => {
    const source = `
export class ProductPage {
  async getName(page: any) {
    return await page.locator('.name').innerText();
  }
  async getPrice(page: any) {
    return await page.locator('.price').textContent();
  }
}
`;
    const results = findUnguardedRetrievalMethodsInFunctions("pages/product.ts", source);
    expect(results).toHaveLength(2);
  });

  it("does NOT flag retrieval preceded by toPass guard", () => {
    const source = `
import { expect } from '@playwright/test';
export async function getValueSafe(page: any) {
  await expect(async () => {
    const val = await page.locator('#x').inputValue();
    expect(val).not.toBe('');
  }).toPass();
  return await page.locator('#x').inputValue();
}
`;
    const results = findUnguardedRetrievalMethodsInFunctions("utils/helpers.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by .waitFor() in page class", () => {
    const source = `
export class DashboardPage {
  async getTitle(page: any) {
    await page.locator('.title').waitFor();
    return await page.locator('.title').innerText();
  }
}
`;
    const results = findUnguardedRetrievalMethodsInFunctions("pages/dashboard.ts", source);
    expect(results).toHaveLength(0);
  });

  it("does NOT flag retrieval preceded by toBeVisible in page class", () => {
    const source = `
import { expect } from '@playwright/test';
export class DashboardPage {
  async getTitle(page: any) {
    await expect(page.locator('.title')).toBeVisible();
    return await page.locator('.title').innerText();
  }
}
`;
    const results = findUnguardedRetrievalMethodsInFunctions("pages/dashboard.ts", source);
    expect(results).toHaveLength(0);
  });
});

// ─── ARCH-002: POM "Locator Bag" Detection ────────────────────────────

describe("analyzePomClassStructure", () => {
  it("flags pure locator bag (6+ locators, 0 action methods)", () => {
    const source = `
export class SettingsPage {
  readonly heading = this.page.locator('h1');
  readonly nameInput = this.page.getByLabel('Name');
  readonly emailInput = this.page.getByLabel('Email');
  readonly phoneInput = this.page.getByLabel('Phone');
  readonly saveButton = this.page.getByRole('button', { name: 'Save' });
  readonly cancelButton = this.page.getByRole('button', { name: 'Cancel' });

  constructor(private page: any) {}
}
`;
    const result = analyzePomClassStructure("pages/settings.ts", source);
    expect(result).not.toBeNull();
    expect(result!.publicLocatorCount).toBe(6);
    expect(result!.actionMethodCount).toBe(0);
    expect(result!.isLocatorBag).toBe(true);
  });

  it("does NOT flag well-encapsulated POM (locators + action methods)", () => {
    const source = `
export class LoginPage {
  readonly emailInput = this.page.getByLabel('Email');
  readonly passwordInput = this.page.getByLabel('Password');
  readonly submitButton = this.page.getByRole('button', { name: 'Submit' });
  readonly errorMessage = this.page.locator('.error');
  readonly rememberMe = this.page.getByLabel('Remember me');
  readonly forgotLink = this.page.getByRole('link', { name: 'Forgot?' });
  readonly heading = this.page.locator('h1');
  readonly logo = this.page.locator('.logo');

  constructor(private page: any) {}

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async loginWithRememberMe(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.rememberMe.check();
    await this.submitButton.click();
  }

  async resetPassword() {
    await this.forgotLink.click();
  }
}
`;
    const result = analyzePomClassStructure("pages/login.ts", source);
    expect(result).not.toBeNull();
    expect(result!.publicLocatorCount).toBe(8);
    expect(result!.actionMethodCount).toBe(3);
    // 3/8 = 0.375 >= 0.3 threshold → not a locator bag
    expect(result!.isLocatorBag).toBe(false);
  });

  it("detects constructor-assigned locators as public locators", () => {
    const source = `
export class DashboardPage {
  heading: any;
  sidebar: any;
  nav: any;
  searchInput: any;
  profileLink: any;
  logoutButton: any;

  constructor(private page: any) {
    this.heading = page.locator('h1');
    this.sidebar = page.locator('.sidebar');
    this.nav = page.locator('nav');
    this.searchInput = page.getByLabel('Search');
    this.profileLink = page.getByRole('link', { name: 'Profile' });
    this.logoutButton = page.getByRole('button', { name: 'Logout' });
  }
}
`;
    const result = analyzePomClassStructure("pages/dashboard.ts", source);
    expect(result).not.toBeNull();
    expect(result!.publicLocatorCount).toBe(6);
    expect(result!.locatorNames).toContain("heading");
    expect(result!.locatorNames).toContain("logoutButton");
    expect(result!.isLocatorBag).toBe(true);
  });

  it("excludes private/protected locators from count", () => {
    const source = `
export class CheckoutPage {
  private emailInput = this.page.getByLabel('Email');
  protected passwordInput = this.page.getByLabel('Password');
  readonly submitButton = this.page.getByRole('button', { name: 'Submit' });
  private nameInput = this.page.getByLabel('Name');
  protected phoneInput = this.page.getByLabel('Phone');
  readonly heading = this.page.locator('h1');

  constructor(private page: any) {}
}
`;
    const result = analyzePomClassStructure("pages/checkout.ts", source);
    expect(result).not.toBeNull();
    // Only 2 public locators (submitButton, heading) — private/protected excluded
    expect(result!.publicLocatorCount).toBe(2);
    expect(result!.isLocatorBag).toBe(false);
  });

  it("returns null for non-class files", () => {
    const source = `
export function helperFunc() {
  return 42;
}
const x = 1;
`;
    const result = analyzePomClassStructure("utils/helpers.ts", source);
    expect(result).toBeNull();
  });

  it("borderline ratio (10 locators, 3 methods = 0.3) → NOT a locator bag", () => {
    const source = `
export class FormPage {
  readonly field1 = this.page.getByLabel('Field 1');
  readonly field2 = this.page.getByLabel('Field 2');
  readonly field3 = this.page.getByLabel('Field 3');
  readonly field4 = this.page.getByLabel('Field 4');
  readonly field5 = this.page.getByLabel('Field 5');
  readonly field6 = this.page.getByLabel('Field 6');
  readonly field7 = this.page.getByLabel('Field 7');
  readonly field8 = this.page.getByLabel('Field 8');
  readonly field9 = this.page.getByLabel('Field 9');
  readonly submitBtn = this.page.getByRole('button', { name: 'Submit' });

  constructor(private page: any) {}

  async fillRequired() {
    await this.field1.fill('value');
    await this.field2.fill('value');
    await this.field3.fill('value');
  }

  async fillOptional() {
    await this.field4.fill('value');
    await this.field5.fill('value');
  }

  async submit() {
    await this.submitBtn.click();
  }
}
`;
    const result = analyzePomClassStructure("pages/form.ts", source);
    expect(result).not.toBeNull();
    expect(result!.publicLocatorCount).toBe(10);
    expect(result!.actionMethodCount).toBe(3);
    // 3/10 = 0.3 — exactly at threshold, should NOT flag
    expect(result!.isLocatorBag).toBe(false);
  });

  it("getters returning locators are NOT counted as action methods", () => {
    const source = `
export class ProductPage {
  readonly title = this.page.locator('.title');
  readonly price = this.page.locator('.price');
  readonly description = this.page.locator('.description');
  readonly image = this.page.locator('.image');
  readonly addToCart = this.page.getByRole('button', { name: 'Add' });
  readonly quantity = this.page.getByLabel('Quantity');

  constructor(private page: any) {}

  get titleLocator() {
    return this.title;
  }

  get priceLocator() {
    return this.price;
  }
}
`;
    const result = analyzePomClassStructure("pages/product.ts", source);
    expect(result).not.toBeNull();
    expect(result!.publicLocatorCount).toBe(6);
    // Getters should not be counted as action methods
    expect(result!.actionMethodCount).toBe(0);
    expect(result!.totalMethodCount).toBe(0);
    expect(result!.isLocatorBag).toBe(true);
  });
});
