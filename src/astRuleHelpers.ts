/**
 * AST-based rule helpers for analytical scanner rules.
 *
 * Uses the TypeScript Compiler API (ts.createSourceFile) for accurate
 * scope-aware detection that regex cannot reliably achieve.
 */
import ts from "typescript";

// ─── Result Types ────────────────────────────────────────────────────

export interface ShadowingResult {
  file: string;
  outerLine: number;
  innerLine: number;
  name: string;
  outerKind: string;
  innerKind: string;
}

export interface CustomAssertionResult {
  file: string;
  importName: string;
  importPath: string;
  callCount: number;
  expectCount: number;
  testCount: number;
}

export interface ManualContextResult {
  file: string;
  line: number;
  testName: string;
  count: number;
}

export interface LargeInlineDataResult {
  file: string;
  line: number;
  endLine: number;
  lineCount: number;
  symbolName: string;
  nodeType: "object" | "array";
}

export interface DataMutationResult {
  file: string;
  line: number;
  bindingName: string;
  importPath: string;
  mutationCount: number;
  snippet: string;
}

export interface MissingAwaitResult {
  file: string;
  line: number;
  testName: string;
  snippet: string;
}

export interface UnguardedRetrievalResult {
  file: string;
  line: number;
  testName: string;
  snippet: string;
}

export interface ImportBinding {
  localName: string;       // name used in the importing file
  originalName: string;    // export name ("default" for default imports)
  modulePath: string;      // relative module specifier
}

export interface DisguisedWaitResult {
  file: string;
  line: number;
  calledFunction: string;
  importPath: string;
}

export interface ClassSleepMethodExport {
  className: string;
  methodNames: string[];
}

export interface PomClassAnalysis {
  className: string;
  extendsClass: string | null;
  publicLocatorCount: number;
  locatorNames: string[];
  actionMethodCount: number;
  actionMethodNames: string[];
  totalMethodCount: number;
  isLocatorBag: boolean;
}

// ─── Shared Utilities ────────────────────────────────────────────────

function parseSource(filePath: string, content: string): ts.SourceFile {
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

/** Check if a CallExpression matches `obj.method()` */
function isMethodCall(
  node: ts.CallExpression,
  obj: string,
  method: string,
): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (expr.name.text !== method) return false;
  if (ts.isIdentifier(expr.expression)) {
    return expr.expression.text === obj;
  }
  return false;
}

/** Check if a CallExpression matches `obj.method()` OR just `func()` */
function isCallTo(node: ts.CallExpression, name: string): boolean {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === name;
  }
  return false;
}

/** Get the root identifier from a PropertyAccessExpression chain */
function getRootIdentifier(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    return getRootIdentifier(node.expression);
  }
  return undefined;
}

/** Get 1-based line number from AST position */
function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Get the declaration keyword text for a variable declaration */
function declKeyword(
  decl: ts.VariableDeclaration,
): "const" | "let" | "var" | "unknown" {
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list)) return "unknown";
  if (list.flags & ts.NodeFlags.Const) return "const";
  if (list.flags & ts.NodeFlags.Let) return "let";
  return "var";
}

// ─── PW-STABILITY-007: Variable Shadowing Between Test Scopes ────────

/**
 * Detect variable shadowing between describe-scope and nested
 * test/hook callbacks. Outer `let`/`var` declarations that are
 * shadowed by inner `const`/`let`/`var` of the same name cause
 * the outer to stay undefined — runtime crash in afterAll.
 */
export function findVariableShadowing(
  filePath: string,
  content: string,
): ShadowingResult[] {
  const sf = parseSource(filePath, content);
  const results: ShadowingResult[] = [];

  function visit(node: ts.Node): void {
    // Find test.describe(..., callback)
    if (
      ts.isCallExpression(node) &&
      isMethodCall(node, "test", "describe")
    ) {
      const callback = node.arguments[1];
      if (
        callback &&
        (ts.isArrowFunction(callback) ||
          ts.isFunctionExpression(callback)) &&
        callback.body &&
        ts.isBlock(callback.body)
      ) {
        analyzeDescribeBlock(sf, callback.body, results);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return results;
}

function analyzeDescribeBlock(
  sf: ts.SourceFile,
  block: ts.Block,
  results: ShadowingResult[],
): void {
  // Collect top-level let/var declarations in describe scope
  const outerVars = new Map<
    string,
    { line: number; kind: string; decl: ts.VariableDeclaration }
  >();

  for (const stmt of block.statements) {
    if (ts.isVariableStatement(stmt)) {
      const keyword = declKeyword(stmt.declarationList.declarations[0]);
      if (keyword === "let" || keyword === "var") {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            // Skip intentionally unused vars (prefixed with _)
            if (name.startsWith("_")) continue;
            outerVars.set(name, {
              line: lineOf(sf, decl.getStart()),
              kind: keyword,
              decl,
            });
          }
        }
      }
    }
  }

  if (outerVars.size === 0) return;

  // Walk nested test/hook callbacks for shadowing declarations
  for (const stmt of block.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const expr = stmt.expression;
    if (!ts.isCallExpression(expr)) continue;

    // Match test(), test.only(), test.beforeAll(), test.afterAll(), etc.
    const callee = expr.expression;
    const isTestLikeCall =
      isCallTo(expr, "test") ||
      (ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "test");

    if (!isTestLikeCall) continue;

    // Find the callback argument (last arg that is a function)
    for (const arg of expr.arguments) {
      if (
        (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) &&
        arg.body &&
        ts.isBlock(arg.body)
      ) {
        collectShadowingInBlock(sf, arg.body, outerVars, results);
      }
    }
  }
}

function collectShadowingInBlock(
  sf: ts.SourceFile,
  block: ts.Block,
  outerVars: Map<string, { line: number; kind: string }>,
  results: ShadowingResult[],
): void {
  function walk(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const outer = outerVars.get(name);
      if (outer) {
        const innerKind = declKeyword(node);
        results.push({
          file: sf.fileName,
          outerLine: outer.line,
          innerLine: lineOf(sf, node.getStart()),
          name,
          outerKind: outer.kind,
          innerKind,
        });
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(block);
}

// ─── PW-FLAKE-007: Custom Assertion Wrappers ─────────────────────────

const ASSERTION_NAME_RE =
  /^(compare|assert|verify|validate|check|ensure|confirm)/i;

/**
 * Detect custom assertion wrappers imported from relative paths
 * that bypass Playwright's auto-retrying expect().
 */
export function findCustomAssertionWrappers(
  filePath: string,
  content: string,
): CustomAssertionResult[] {
  const sf = parseSource(filePath, content);

  // 1. Collect assertion-like imports from relative paths
  const assertionBindings = new Map<string, string>(); // name → module path

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const specifier = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    const modulePath = specifier.text;
    // Only relative imports
    if (!modulePath.startsWith("./") && !modulePath.startsWith("../")) continue;

    if (stmt.importClause) {
      // Named imports: import { compareFoo } from './utils'
      const namedBindings = stmt.importClause.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const el of namedBindings.elements) {
          const name = el.name.text;
          if (ASSERTION_NAME_RE.test(name)) {
            assertionBindings.set(name, modulePath);
          }
        }
      }
      // Default import: import compareFoo from './utils'
      if (stmt.importClause.name) {
        const name = stmt.importClause.name.text;
        if (ASSERTION_NAME_RE.test(name)) {
          assertionBindings.set(name, modulePath);
        }
      }
    }
  }

  if (assertionBindings.size === 0) return [];

  // 2. Count calls to each assertion binding AND expect() calls AND test() blocks
  const callCounts = new Map<string, number>();
  let expectCount = 0;
  let testCount = 0;

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      // Count expect()
      if (ts.isIdentifier(node.expression) && node.expression.text === "expect") {
        expectCount++;
      }
      // Count test() / test.only()
      if (isCallTo(node, "test") || isMethodCall(node, "test", "only")) {
        testCount++;
      }
      // Count assertion binding calls
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (assertionBindings.has(name)) {
          callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
        }
      }
      // Also check await expressions: await compareFoo(...)
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);

  // 3. Flag if custom calls ≥ 2 AND (expect count < test count OR custom calls > expect count)
  const results: CustomAssertionResult[] = [];
  for (const [name, modulePath] of assertionBindings) {
    const count = callCounts.get(name) ?? 0;
    if (count >= 2 && (expectCount < testCount || count > expectCount)) {
      results.push({
        file: filePath,
        importName: name,
        importPath: modulePath,
        callCount: count,
        expectCount,
        testCount,
      });
    }
  }

  return results;
}

// ─── PW-STABILITY-008: Manual Browser Context in Test Bodies ─────────

/**
 * Check if a node is inside a VariableDeclaration within the given boundary.
 * Used to distinguish locally-declared contexts (const/let/var inside test body)
 * from assignments to outer-scoped variables (describe-level, accessible to afterAll).
 */
function isLocallyDeclared(node: ts.Node, boundary: ts.Node): boolean {
  let current = node.parent;
  while (current && current !== boundary) {
    if (ts.isVariableDeclaration(current)) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Detect `browser.newContext()` calls inside test() callbacks.
 * Fixtures handle lifecycle automatically (including failure scenarios).
 *
 * Only flags calls where the context is locally declared (const/let/var)
 * inside the test body. Assignments to outer-scoped variables (declared in
 * describe scope) are skipped because afterAll/afterEach can access them
 * for cleanup.
 */
export function findManualContextInTestBodies(
  filePath: string,
  content: string,
): ManualContextResult[] {
  const sf = parseSource(filePath, content);
  const results: ManualContextResult[] = [];

  function visit(node: ts.Node): void {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    // Match test(...) or test.only(...)
    const isTestCall =
      isCallTo(node, "test") || isMethodCall(node, "test", "only");
    if (!isTestCall) {
      ts.forEachChild(node, visit);
      return;
    }

    // Skip hooks: test.beforeAll, test.afterAll, test.beforeEach, test.afterEach
    if (ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (
        method === "beforeAll" ||
        method === "afterAll" ||
        method === "beforeEach" ||
        method === "afterEach" ||
        method === "describe"
      ) {
        ts.forEachChild(node, visit);
        return;
      }
    }

    // Extract test name from 1st argument
    let testName = "(unnamed)";
    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      testName = node.arguments[0].text;
    }

    // Find the callback (2nd or last arg that is a function)
    let callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
    for (const arg of node.arguments) {
      if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
        callback = arg;
      }
    }

    if (!callback || !callback.body || !ts.isBlock(callback.body)) {
      ts.forEachChild(node, visit);
      return;
    }

    // Count browser.newContext() and request.newContext() calls in the callback body.
    // Only count calls where the result is locally declared (const/let/var) inside
    // the test body. If assigned to an outer-scoped variable (describe level),
    // afterAll/afterEach can clean it up — skip those.
    const bodyBlock = callback.body;
    let newContextCount = 0;
    let firstLine = 0;
    function walkBody(n: ts.Node): void {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "newContext" &&
        ts.isIdentifier(n.expression.expression) &&
        (n.expression.expression.text === "browser" ||
         n.expression.expression.text === "request")
      ) {
        if (isLocallyDeclared(n, bodyBlock)) {
          newContextCount++;
          if (firstLine === 0) {
            firstLine = lineOf(sf, n.getStart());
          }
        }
      }
      ts.forEachChild(n, walkBody);
    }
    walkBody(bodyBlock);

    if (newContextCount > 0) {
      results.push({
        file: filePath,
        line: firstLine,
        testName,
        count: newContextCount,
      });
    }

    // Don't recurse into the test callback again (already walked)
  }

  visit(sf);
  return results;
}

// ─── ARCH-012: Mutating Imported Test Data Objects ───────────────────

const DATA_PATH_RE = /(?:data|fixture|constant|config)/i;

/**
 * Detect mutations of imported test-data objects (namespace or named imports
 * from relative paths). Mutating shared module-level objects breaks
 * parallel execution.
 */
export function findTestDataMutations(
  filePath: string,
  content: string,
): DataMutationResult[] {
  const sf = parseSource(filePath, content);

  // 1. Collect import bindings
  const importBindings = new Map<string, string>(); // binding name → module path

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const specifier = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    const modulePath = specifier.text;
    // Only relative imports
    if (!modulePath.startsWith("./") && !modulePath.startsWith("../")) continue;

    if (stmt.importClause) {
      const namedBindings = stmt.importClause.namedBindings;
      // Namespace imports: import * as testData from './data'
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        importBindings.set(namedBindings.name.text, modulePath);
      }
      // Named imports from data-like paths
      if (
        namedBindings &&
        ts.isNamedImports(namedBindings) &&
        DATA_PATH_RE.test(modulePath)
      ) {
        for (const el of namedBindings.elements) {
          importBindings.set(el.name.text, modulePath);
        }
      }
      // Default import from data-like paths
      if (stmt.importClause.name && DATA_PATH_RE.test(modulePath)) {
        importBindings.set(stmt.importClause.name.text, modulePath);
      }
    }
  }

  if (importBindings.size === 0) return [];

  // 2. Find assignments where left side is a property of an imported binding
  const mutations = new Map<
    string,
    { importPath: string; lines: number[]; snippets: string[] }
  >();

  function walk(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const left = node.left;
      if (ts.isPropertyAccessExpression(left) || ts.isElementAccessExpression(left)) {
        const root = getRootIdentifier(left);
        if (root && importBindings.has(root)) {
          const entry = mutations.get(root) ?? {
            importPath: importBindings.get(root)!,
            lines: [],
            snippets: [],
          };
          entry.lines.push(lineOf(sf, node.getStart()));
          const lineText = content
            .split(/\r?\n/)
            [lineOf(sf, node.getStart()) - 1]?.trim()
            .slice(0, 120);
          entry.snippets.push(lineText ?? "");
          mutations.set(root, entry);
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);

  // 3. Build results
  const results: DataMutationResult[] = [];
  for (const [binding, data] of mutations) {
    results.push({
      file: filePath,
      line: data.lines[0],
      bindingName: binding,
      importPath: data.importPath,
      mutationCount: data.lines.length,
      snippet: `${data.lines.length} mutation(s) of '${binding}' from ${data.importPath}`,
    });
  }

  return results;
}

// ─── PW-FLAKE-008: Missing await on Async Playwright APIs ───────────

const ASYNC_MATCHERS = new Set([
  "toBeAttached", "toBeChecked", "toBeDisabled", "toBeEditable",
  "toBeEmpty", "toBeEnabled", "toBeFocused", "toBeHidden",
  "toBeInViewport", "toBeVisible", "toContainText",
  "toHaveAccessibleDescription", "toHaveAccessibleName",
  "toHaveAttribute", "toHaveCSS", "toHaveClass", "toHaveCount",
  "toHaveId", "toHaveJSProperty", "toHaveRole", "toHaveScreenshot",
  "toHaveText", "toHaveTitle", "toHaveURL", "toHaveValue",
  "toHaveValues", "toPass",
]);

/**
 * Walk a call-expression chain and check whether the root is
 * `expect(...)`, `expect.soft(...)`, or `expect.poll(...)`.
 * Returns the kind if found, undefined otherwise.
 */
function getExpectChainKind(
  node: ts.CallExpression,
): "expect" | "expect.soft" | "expect.poll" | undefined {
  // Walk the expression to find the root call
  let current: ts.Expression = node.expression;

  // Peel off PropertyAccessExpression layers: e.g. expect(...).not.toBeVisible
  while (ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }

  // Now `current` should be the root call: expect(...) / expect.soft(...) / expect.poll(...)
  if (!ts.isCallExpression(current)) return undefined;

  const callee = current.expression;

  // expect(...)
  if (ts.isIdentifier(callee) && callee.text === "expect") {
    return "expect";
  }

  // expect.soft(...) or expect.poll(...)
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "expect"
  ) {
    const method = callee.name.text;
    if (method === "soft") return "expect.soft";
    if (method === "poll") return "expect.poll";
  }

  return undefined;
}

/**
 * Get the final method name from a call expression's property chain.
 * e.g. `expect(x).not.toBeVisible()` → "toBeVisible"
 */
function getFinalMethodName(node: ts.CallExpression): string | undefined {
  if (ts.isPropertyAccessExpression(node.expression)) {
    return node.expression.name.text;
  }
  return undefined;
}

/** Check if a CallExpression is `test.step(...)` */
function isTestStepCall(node: ts.CallExpression): boolean {
  return isMethodCall(node, "test", "step");
}

/**
 * Detect missing `await` on async Playwright APIs inside test() callbacks.
 *
 * Catches:
 * - `expect(locator).toBeVisible()` (and all 28 async matchers)
 * - `expect.soft(locator).toBeVisible()` (soft assertion variants)
 * - `expect.poll(() => ...).toBe(...)` (poll chains)
 * - `test.step("name", async () => { ... })` (unawaited steps)
 * - Negated forms: `expect(x).not.toBeVisible()`
 */
export function findMissingPlaywrightAwaits(
  filePath: string,
  content: string,
): MissingAwaitResult[] {
  const sf = parseSource(filePath, content);
  const results: MissingAwaitResult[] = [];

  function visit(node: ts.Node): void {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    // Match test(...) or test.only(...)
    const isTestCall =
      isCallTo(node, "test") || isMethodCall(node, "test", "only");
    if (!isTestCall) {
      ts.forEachChild(node, visit);
      return;
    }

    // Skip hooks and describe
    if (ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (
        method === "beforeAll" ||
        method === "afterAll" ||
        method === "beforeEach" ||
        method === "afterEach" ||
        method === "describe"
      ) {
        ts.forEachChild(node, visit);
        return;
      }
    }

    // Extract test name
    let testName = "(unnamed)";
    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      testName = node.arguments[0].text;
    }

    // Find the callback
    let callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
    for (const arg of node.arguments) {
      if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
        callback = arg;
      }
    }

    if (!callback || !callback.body || !ts.isBlock(callback.body)) {
      ts.forEachChild(node, visit);
      return;
    }

    // Walk the callback body for unawaited async patterns
    function walkBody(n: ts.Node): void {
      if (ts.isExpressionStatement(n)) {
        const expr = n.expression;

        // If the expression is an AwaitExpression, it's properly awaited — skip
        if (ts.isAwaitExpression(expr)) {
          return;
        }

        if (ts.isCallExpression(expr)) {
          // Check for unawaited test.step(...)
          if (isTestStepCall(expr)) {
            results.push({
              file: filePath,
              line: lineOf(sf, n.getStart()),
              testName,
              snippet: "test.step(...)",
            });
            return;
          }

          // Check for unawaited expect chain with async matcher
          const methodName = getFinalMethodName(expr);
          if (methodName) {
            const chainKind = getExpectChainKind(expr);

            if (chainKind === "expect.poll") {
              // Any matcher on expect.poll() is async
              results.push({
                file: filePath,
                line: lineOf(sf, n.getStart()),
                testName,
                snippet: `expect.poll(...).${methodName}(...)`,
              });
              return;
            }

            if (
              (chainKind === "expect" || chainKind === "expect.soft") &&
              ASYNC_MATCHERS.has(methodName)
            ) {
              const prefix = chainKind === "expect.soft"
                ? "expect.soft(...)"
                : "expect(...)";
              results.push({
                file: filePath,
                line: lineOf(sf, n.getStart()),
                testName,
                snippet: `${prefix}.${methodName}(...)`,
              });
              return;
            }
          }
        }
      }

      ts.forEachChild(n, walkBody);
    }

    walkBody(callback.body);
    // Don't recurse into the test callback again
  }

  visit(sf);
  return results;
}

// ─── PW-FLAKE-001 Enhancement: Disguised Hard Wait Detection ─────────

const RETRY_INTENT_KEYWORDS = ["retry", "attempt", "backoff", "polling", "reconnect"];

/**
 * Extract all named/default import bindings from relative paths.
 * Skips namespace imports (`import * as ...`) and non-relative imports.
 */
export function extractRelativeImportBindings(
  filePath: string,
  content: string,
): ImportBinding[] {
  const sf = parseSource(filePath, content);
  const bindings: ImportBinding[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const specifier = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    const modulePath = specifier.text;
    if (!modulePath.startsWith("./") && !modulePath.startsWith("../")) continue;

    if (!stmt.importClause) continue;

    // Default import
    if (stmt.importClause.name) {
      bindings.push({
        localName: stmt.importClause.name.text,
        originalName: "default",
        modulePath,
      });
    }

    const namedBindings = stmt.importClause.namedBindings;
    if (!namedBindings) continue;

    // Skip namespace imports (import * as ...)
    if (ts.isNamespaceImport(namedBindings)) continue;

    // Named imports
    if (ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) {
        bindings.push({
          localName: el.name.text,
          originalName: el.propertyName ? el.propertyName.text : el.name.text,
          modulePath,
        });
      }
    }
  }

  return bindings;
}

/**
 * Check whether a function body contains a sleep pattern:
 * - `new Promise(... => setTimeout(...))`
 * - `waitForTimeout(...)` as a property access call
 * - Direct `setTimeout(...)` call
 */
function bodyContainsSleepPattern(body: ts.Node): boolean {
  let found = false;
  function walk(node: ts.Node): void {
    if (found) return;

    if (ts.isCallExpression(node)) {
      // Direct setTimeout(...)
      if (ts.isIdentifier(node.expression) && node.expression.text === "setTimeout") {
        found = true;
        return;
      }
      // *.waitForTimeout(...)
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "waitForTimeout"
      ) {
        found = true;
        return;
      }
      // *.waitForNetworkIdle(...)
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "waitForNetworkIdle"
      ) {
        found = true;
        return;
      }
      // *.waitForLoadState('networkidle')
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "waitForLoadState" &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === "networkidle"
      ) {
        found = true;
        return;
      }
    }

    // new Promise(... => setTimeout(...))
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Promise"
    ) {
      const args = node.arguments;
      if (args && args.length > 0) {
        function walkForSetTimeout(n: ts.Node): void {
          if (found) return;
          if (
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === "setTimeout"
          ) {
            found = true;
            return;
          }
          ts.forEachChild(n, walkForSetTimeout);
        }
        for (const arg of args) {
          walkForSetTimeout(arg);
        }
      }
      return;
    }

    ts.forEachChild(node, walk);
  }
  walk(body);
  return found;
}

/**
 * Check whether a function body contains a loop with retry-intent identifiers.
 * Used to suppress false positives on retry/polling wrappers.
 */
function bodyHasRetryLoop(body: ts.Node, sf: ts.SourceFile): boolean {
  let hasLoop = false;
  let hasRetryIntent = false;

  function walk(node: ts.Node): void {
    if (hasLoop && hasRetryIntent) return;

    if (
      ts.isWhileStatement(node) ||
      ts.isForStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isDoStatement(node)
    ) {
      hasLoop = true;
    }

    if (ts.isIdentifier(node)) {
      const name = node.text.toLowerCase();
      if (RETRY_INTENT_KEYWORDS.some((kw) => name.includes(kw))) {
        hasRetryIntent = true;
      }
    }

    if (ts.isStringLiteral(node)) {
      const text = node.text.toLowerCase();
      if (RETRY_INTENT_KEYWORDS.some((kw) => text.includes(kw))) {
        hasRetryIntent = true;
      }
    }

    ts.forEachChild(node, walk);
  }
  walk(body);
  return hasLoop && hasRetryIntent;
}

/**
 * Parse a utility module and return names of exported functions whose body
 * is a sleep wrapper (Promise-setTimeout, waitForTimeout, direct setTimeout).
 * Excludes functions with retry/polling loop patterns (false-positive filter).
 */
export function findSleepWrapperExports(
  filePath: string,
  content: string,
): string[] {
  const sf = parseSource(filePath, content);

  // 1. Collect all module-level function bodies by name
  const funcBodies = new Map<string, ts.Node>();
  // 2. Collect exported names
  const exportedNames = new Set<string>();

  for (const stmt of sf.statements) {
    // Function declarations: function foo() { ... }
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      funcBodies.set(stmt.name.text, stmt.body);
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        exportedNames.add(stmt.name.text);
      }
      if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        exportedNames.add(stmt.name.text);
      }
    }

    // Variable declarations: const foo = async () => { ... }
    if (ts.isVariableStatement(stmt)) {
      const isExported = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = decl.initializer;
        if (
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          init.body
        ) {
          funcBodies.set(decl.name.text, init.body);
          if (isExported) {
            exportedNames.add(decl.name.text);
          }
        }
      }
    }

    // export { name1, name2 }
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        const localName = el.propertyName ? el.propertyName.text : el.name.text;
        exportedNames.add(localName);
      }
    }

    // export default identifier
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      exportedNames.add(stmt.expression.text);
    }
  }

  // 3. For each exported function, check if body is a sleep wrapper
  const results: string[] = [];
  for (const name of exportedNames) {
    const body = funcBodies.get(name);
    if (!body) continue;

    if (bodyHasRetryLoop(body, sf)) continue;

    if (bodyContainsSleepPattern(body)) {
      results.push(name);
    }
  }

  return results;
}

/**
 * Parse a utility module and return exported classes that contain methods
 * whose body is a sleep wrapper (Promise-setTimeout, waitForTimeout, direct setTimeout).
 * Excludes methods with retry/polling loop patterns (false-positive filter).
 */
export function findClassSleepMethodExports(
  filePath: string,
  content: string,
): ClassSleepMethodExport[] {
  const sf = parseSource(filePath, content);

  // Collect names exported via `export { ClassName }` or `export default ident`
  const reExportedNames = new Set<string>();
  const defaultExportedNames = new Set<string>();

  for (const stmt of sf.statements) {
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      for (const el of stmt.exportClause.elements) {
        const localName = el.propertyName ? el.propertyName.text : el.name.text;
        reExportedNames.add(localName);
      }
    }
    if (ts.isExportAssignment(stmt) && ts.isIdentifier(stmt.expression)) {
      defaultExportedNames.add(stmt.expression.text);
    }
  }

  const results: ClassSleepMethodExport[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;

    // Determine if the class is exported
    const hasExportModifier = stmt.modifiers?.some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    const className = stmt.name?.text;
    const isExported =
      hasExportModifier ||
      (className !== undefined && reExportedNames.has(className)) ||
      (className !== undefined && defaultExportedNames.has(className));

    if (!isExported) continue;

    const sleepMethods: string[] = [];

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (!member.body) continue;
      if (!member.name || !ts.isIdentifier(member.name)) continue;

      if (bodyHasRetryLoop(member.body, sf)) continue;
      if (bodyContainsSleepPattern(member.body)) {
        sleepMethods.push(member.name.text);
      }
    }

    if (sleepMethods.length > 0) {
      results.push({
        className: className ?? "default",
        methodNames: sleepMethods,
      });
    }
  }

  return results;
}

/**
 * Given a test file and a map of wrapper binding names → import paths,
 * find call sites of those wrappers. Returns line numbers and function names.
 */
export function findDisguisedHardWaitCalls(
  filePath: string,
  content: string,
  wrapperBindings: Map<string, string>,
  sleepMethodBindings?: Map<string, string>,
): DisguisedWaitResult[] {
  if (wrapperBindings.size === 0 && (!sleepMethodBindings || sleepMethodBindings.size === 0)) return [];

  const sf = parseSource(filePath, content);
  const results: DisguisedWaitResult[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      // Direct function call: delay(2000)
      if (ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        const importPath = wrapperBindings.get(name);
        if (importPath) {
          results.push({
            file: filePath,
            line: lineOf(sf, node.getStart()),
            calledFunction: name,
            importPath,
          });
        }
      }
      // Property access call: instance.delay(2000) or this.delay(2000)
      if (
        sleepMethodBindings &&
        sleepMethodBindings.size > 0 &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const methodName = node.expression.name.text;
        const importPath = sleepMethodBindings.get(methodName);
        if (importPath) {
          results.push({
            file: filePath,
            line: lineOf(sf, node.getStart()),
            calledFunction: methodName,
            importPath,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return results;
}

// ─── PW-FLAKE-010: Retrieval Methods Without Content Guard ────────────

const RETRIEVAL_METHODS = new Set([
  "innerText", "textContent", "allInnerTexts",
  "allTextContents", "innerHTML", "inputValue",
]);

const CONTENT_GUARD_MATCHERS = new Set([
  "toHaveText", "toContainText", "toBeEmpty", "toBeVisible",
]);

/**
 * Check whether a CallExpression is a content-guard assertion.
 *
 * Content guards are:
 * 1. `expect()` chains whose final matcher is one of `toHaveText`,
 *    `toContainText`, `toBeEmpty`, `toBeVisible`, or `toPass` — including
 *    negated forms (`.not.toHaveText(...)`) and `.resolves`/`.rejects`.
 * 2. Direct `locator.waitFor()` calls — these wait for the element to reach
 *    an actionable state (default: "visible"), ensuring content is ready.
 */
function isContentGuard(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const methodName = getFinalMethodName(node);
  if (!methodName) return false;

  // locator.waitFor() is a guard (waits for "visible" state by default)
  if (methodName === "waitFor") {
    // Accept if it's NOT inside an expect() chain — i.e. it's a direct locator call
    const kind = getExpectChainKind(node);
    if (kind === undefined) return true;
  }

  // toPass() is a guard regardless of chain root
  if (methodName === "toPass") {
    const kind = getExpectChainKind(node);
    return kind !== undefined;
  }

  if (!CONTENT_GUARD_MATCHERS.has(methodName)) return false;
  const kind = getExpectChainKind(node);
  return kind !== undefined;
}

/**
 * Check if a CallExpression is a retrieval method call: `.innerText()`, etc.
 * Returns the method name if matched, undefined otherwise.
 */
function getRetrievalMethodName(node: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const name = node.expression.name.text;
  return RETRIEVAL_METHODS.has(name) ? name : undefined;
}

/**
 * Detect retrieval method calls (innerText, textContent, innerHTML, etc.)
 * that are NOT preceded by a content guard within the same test body.
 *
 * A content guard is an expect() assertion with toHaveText, toContainText,
 * toBeEmpty, or toPass that targets the same locator (or any locator within
 * the preceding statements). The AST approach lets us check the actual
 * statement ordering within the test callback body rather than relying on
 * a fragile line-window regex heuristic.
 */
export function findUnguardedRetrievalMethods(
  filePath: string,
  content: string,
): UnguardedRetrievalResult[] {
  const sf = parseSource(filePath, content);
  const results: UnguardedRetrievalResult[] = [];

  function visit(node: ts.Node): void {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    // Match test(...), test.only(...), test.slow(...)
    const isTestCall =
      isCallTo(node, "test") || isMethodCall(node, "test", "only") ||
      isMethodCall(node, "test", "slow");
    if (!isTestCall) {
      ts.forEachChild(node, visit);
      return;
    }

    // Skip hooks and describe
    if (ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (
        method === "beforeAll" || method === "afterAll" ||
        method === "beforeEach" || method === "afterEach" ||
        method === "describe"
      ) {
        ts.forEachChild(node, visit);
        return;
      }
    }

    // Extract test name
    let testName = "(unnamed)";
    if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      testName = node.arguments[0].text;
    }

    // Find the callback
    let callback: ts.ArrowFunction | ts.FunctionExpression | undefined;
    for (const arg of node.arguments) {
      if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
        callback = arg;
      }
    }

    if (!callback || !callback.body || !ts.isBlock(callback.body)) {
      ts.forEachChild(node, visit);
      return;
    }

    // Collect statements in order; track which statements contain content guards
    const stmts = callback.body.statements;
    const guardSeen = new Set<number>(); // statement indices that contain guards

    // First pass: identify which statements contain content guards
    for (let i = 0; i < stmts.length; i++) {
      if (stmtContainsContentGuard(stmts[i])) {
        guardSeen.add(i);
      }
    }

    // Second pass: find retrieval method calls and check for preceding guards
    for (let i = 0; i < stmts.length; i++) {
      collectRetrievalCalls(stmts[i], sf).forEach((call) => {
        // Check if any of the preceding statements (within 5 statements) is a guard
        const windowStart = Math.max(0, i - 5);
        let guarded = false;
        for (let j = windowStart; j < i; j++) {
          if (guardSeen.has(j)) {
            guarded = true;
            break;
          }
        }
        // If the statement itself contains a guard, treat the retrieval as guarded
        if (guardSeen.has(i)) guarded = true;

        if (!guarded) {
          results.push({
            file: filePath,
            line: call.line,
            testName,
            snippet: `.${call.method}()`,
          });
        }
      });
    }
  }

  visit(sf);
  return results;
}

/**
 * Scan non-test files (POMs, page classes, fixtures) for retrieval method
 * calls without a preceding content guard in the same function body.
 *
 * Walks every function, method, and arrow-function body in the file.
 * Uses the same 5-statement guard window as the test-scoped variant.
 */
export function findUnguardedRetrievalMethodsInFunctions(
  filePath: string,
  content: string,
): UnguardedRetrievalResult[] {
  const sf = parseSource(filePath, content);
  const results: UnguardedRetrievalResult[] = [];

  function visit(node: ts.Node): void {
    // Skip arrow/function expressions that are arguments to expect() chains —
    // these are assertion/polling callbacks where retrieval is intentional.
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      ts.isCallExpression(node.parent)
    ) {
      const parentCall = node.parent;
      // Direct expect(..., callback) or expect.poll(callback)
      const chainKind = getExpectChainKind(parentCall);
      if (chainKind !== undefined) return;
      // Callback is an argument to expect() itself: expect(async () => { ... })
      if (
        ts.isIdentifier(parentCall.expression) &&
        parentCall.expression.text === "expect"
      ) return;
    }

    // Match any function-like body: methods, arrow functions, function declarations/expressions
    let body: ts.Block | undefined;
    let scopeName = "(anonymous)";

    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      body = node.body && ts.isBlock(node.body) ? node.body : undefined;
      scopeName = node.name?.text ?? "(anonymous)";
    } else if (ts.isMethodDeclaration(node)) {
      body = node.body && ts.isBlock(node.body) ? node.body : undefined;
      if (ts.isIdentifier(node.name)) scopeName = node.name.text;
      else if (ts.isStringLiteral(node.name)) scopeName = node.name.text;
    } else if (ts.isArrowFunction(node) && node.body && ts.isBlock(node.body)) {
      body = node.body;
      // Try to get name from parent variable declaration
      if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
        scopeName = node.parent.name.text;
      }
    }

    if (body) {
      const stmts = body.statements;
      const guardSeen = new Set<number>();

      for (let i = 0; i < stmts.length; i++) {
        if (stmtContainsContentGuard(stmts[i])) {
          guardSeen.add(i);
        }
      }

      for (let i = 0; i < stmts.length; i++) {
        collectRetrievalCalls(stmts[i], sf).forEach((call) => {
          const windowStart = Math.max(0, i - 5);
          let guarded = false;
          for (let j = windowStart; j < i; j++) {
            if (guardSeen.has(j)) { guarded = true; break; }
          }
          if (guardSeen.has(i)) guarded = true;

          if (!guarded) {
            results.push({
              file: filePath,
              line: call.line,
              testName: scopeName,
              snippet: `.${call.method}()`,
            });
          }
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return results;
}

/** Check if any node within a statement subtree contains a content guard. */
function stmtContainsContentGuard(node: ts.Node): boolean {
  if (isContentGuard(node)) return true;
  let found = false;
  function walk(n: ts.Node): void {
    if (found) return;
    if (isContentGuard(n)) { found = true; return; }
    ts.forEachChild(n, walk);
  }
  ts.forEachChild(node, walk);
  return found;
}

/** Collect all retrieval method calls from a statement subtree.
 *  Skips nested arrow/function expressions (callbacks) since those
 *  run in a different execution context (e.g., expect.poll callbacks). */
function collectRetrievalCalls(
  node: ts.Node,
  sf: ts.SourceFile,
): Array<{ line: number; method: string }> {
  const calls: Array<{ line: number; method: string }> = [];
  function walk(n: ts.Node): void {
    // Don't descend into nested callbacks — those are separate contexts
    if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) return;
    if (ts.isCallExpression(n)) {
      const method = getRetrievalMethodName(n);
      if (method) {
        calls.push({ line: lineOf(sf, n.getStart()), method });
      }
    }
    ts.forEachChild(n, walk);
  }
  walk(node);
  return calls;
}

// ─── ARCH-002: AST-Based POM "Locator Bag" Detection ─────────────────

/** Locator-related Playwright page method prefixes. */
const LOCATOR_PAGE_METHODS = new Set([
  "locator",
  "getByRole",
  "getByText",
  "getByLabel",
  "getByPlaceholder",
  "getByAltText",
  "getByTitle",
  "getByTestId",
]);

function isLocatorInit(expr: ts.Expression): boolean {
  // Matches: (this.)page.locator() / (this.)page.getBy*()
  if (!ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const methodName = callee.name.text;
  if (!LOCATOR_PAGE_METHODS.has(methodName)) return false;
  // The object should be `page` or `this.page`
  const obj = callee.expression;
  if (ts.isIdentifier(obj) && obj.text === "page") return true;
  if (
    ts.isPropertyAccessExpression(obj) &&
    obj.name.text === "page" &&
    obj.expression.kind === ts.SyntaxKind.ThisKeyword
  ) return true;
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === kind) ?? false;
}

function isPrivateOrProtected(node: ts.Node): boolean {
  return (
    hasModifier(node, ts.SyntaxKind.PrivateKeyword) ||
    hasModifier(node, ts.SyntaxKind.ProtectedKeyword)
  );
}

/**
 * Analyze a POM file's class structure to determine if it is a "locator bag":
 * a class with many public locators and few/no action methods that use them.
 *
 * Returns null if the file does not contain a class declaration.
 */
export function analyzePomClassStructure(
  filePath: string,
  content: string,
): PomClassAnalysis | null {
  const sf = parseSource(filePath, content);

  // Find the first class declaration
  let classDecl: ts.ClassDeclaration | undefined;
  function findClass(node: ts.Node): void {
    if (classDecl) return;
    if (ts.isClassDeclaration(node)) {
      classDecl = node;
      return;
    }
    ts.forEachChild(node, findClass);
  }
  findClass(sf);

  if (!classDecl) return null;

  const className = classDecl.name?.text ?? "(anonymous)";
  let extendsClass: string | null = null;
  if (classDecl.heritageClauses) {
    for (const clause of classDecl.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0) {
        const baseExpr = clause.types[0].expression;
        if (ts.isIdentifier(baseExpr)) {
          extendsClass = baseExpr.text;
        }
      }
    }
  }

  // Phase 1: Discover public locator properties
  const locatorNames: string[] = [];

  // Map property names to their declarations for modifier checking
  const propertyDecls = new Map<string, ts.PropertyDeclaration>();
  for (const member of classDecl.members) {
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
      propertyDecls.set(member.name.text, member);
    }
  }

  // 1a: Property declarations with locator initializers
  for (const member of classDecl.members) {
    if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
      if (isPrivateOrProtected(member)) continue;
      if (member.initializer && isLocatorInit(member.initializer)) {
        locatorNames.push(member.name.text);
      }
    }
  }

  // 1b: Constructor-assigned locators: this.foo = (this.)page.locator/getBy*()
  for (const member of classDecl.members) {
    if (!ts.isConstructorDeclaration(member) || !member.body) continue;
    for (const stmt of member.body.statements) {
      if (!ts.isExpressionStatement(stmt)) continue;
      const expr = stmt.expression;
      if (!ts.isBinaryExpression(expr) || expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;

      // LHS: this.foo
      const lhs = expr.left;
      if (
        !ts.isPropertyAccessExpression(lhs) ||
        lhs.expression.kind !== ts.SyntaxKind.ThisKeyword ||
        !ts.isIdentifier(lhs.name)
      ) continue;

      const propName = lhs.name.text;

      // Skip if already found via property declaration
      if (locatorNames.includes(propName)) continue;

      // Check the RHS is a locator init
      if (!isLocatorInit(expr.right)) continue;

      // Check if the property declaration has private/protected
      const propDecl = propertyDecls.get(propName);
      if (propDecl && isPrivateOrProtected(propDecl)) continue;

      locatorNames.push(propName);
    }
  }

  const publicLocatorCount = locatorNames.length;
  const locatorNameSet = new Set(locatorNames);

  // Phase 2: Count action methods that reference locators via this.<locatorName>
  const actionMethodNames: string[] = [];
  let totalMethodCount = 0;

  for (const member of classDecl.members) {
    // Skip getters and setters — they're separate AST node types
    if (ts.isGetAccessorDeclaration(member)) continue;
    if (ts.isSetAccessorDeclaration(member)) continue;

    if (!ts.isMethodDeclaration(member)) continue;
    if (!ts.isIdentifier(member.name)) continue;

    // Skip constructor (already handled above; methods only)
    const methodName = member.name.text;
    if (methodName === "constructor") continue;

    totalMethodCount++;

    // Check if method body references this.<locatorName>
    if (!member.body) continue;
    let referencesLocator = false;

    function checkLocatorRef(node: ts.Node): void {
      if (referencesLocator) return;
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(node.name) &&
        locatorNameSet.has(node.name.text)
      ) {
        referencesLocator = true;
        return;
      }
      ts.forEachChild(node, checkLocatorRef);
    }
    checkLocatorRef(member.body);

    if (referencesLocator) {
      actionMethodNames.push(methodName);
    }
  }

  const actionMethodCount = actionMethodNames.length;

  // A POM is a "locator bag" when it has many public locators
  // and fewer than 30% of them have wrapping action methods.
  const isLocatorBag =
    publicLocatorCount > 5 &&
    (publicLocatorCount === 0 || actionMethodCount / publicLocatorCount < 0.3);

  return {
    className,
    extendsClass,
    publicLocatorCount,
    locatorNames,
    actionMethodCount,
    actionMethodNames,
    totalMethodCount,
    isLocatorBag,
  };
}

// ─── ARCH-008: Large Inline Data Literals ────────────────────────────

/**
 * Check whether an ObjectLiteralExpression or ArrayLiteralExpression is
 * "data-like": mostly primitives / nested object-arrays, no function or
 * class values. Returns false if any element is an arrow function,
 * function expression, or class expression.
 */
function isDataLike(node: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression): boolean {
  const children: ts.NodeArray<ts.Node> = ts.isObjectLiteralExpression(node)
    ? node.properties
    : node.elements;
  for (const child of children) {
    if (ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isClassExpression(child)) {
      return false;
    }
    if (ts.isPropertyAssignment(child)) {
      const init = child.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isClassExpression(init)) {
        return false;
      }
    }
    if (ts.isSpreadAssignment(child) || ts.isSpreadElement(child)) {
      // Spread from an import (e.g. ...basePayload) is fine — skip deep check
      continue;
    }
  }
  return true;
}

/**
 * Infer a symbol name for the variable/property that holds the literal.
 * Walks up through parents: VariableDeclaration → name, PropertyAssignment → name,
 * ExportAssignment → "default", otherwise "(anonymous)".
 */
function inferSymbolName(node: ts.Node): string {
  const parent = node.parent;
  if (!parent) return "(anonymous)";

  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (ts.isPropertyAssignment(parent) && ts.isStringLiteral(parent.name)) {
    return parent.name.text;
  }
  if (ts.isExportAssignment(parent)) {
    return "default";
  }
  // `as const` satisfies: unwrap one level
  if (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) {
    return inferSymbolName(parent);
  }
  return "(anonymous)";
}

/**
 * Find large inline object/array literals (≥ threshold lines) in a source file.
 * Only counts ObjectLiteralExpression and ArrayLiteralExpression nodes that are
 * data-like (no function values). Ignores function bodies, class bodies, type
 * declarations, and import/export blocks.
 */
export function findLargeInlineDataLiterals(
  filePath: string,
  content: string,
  threshold: number = 50,
): LargeInlineDataResult[] {
  const sf = parseSource(filePath, content);
  const results: LargeInlineDataResult[] = [];

  function visit(node: ts.Node): void {
    // Only inspect object and array literal expressions
    if (
      (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) &&
      isDataLike(node)
    ) {
      const startLine = lineOf(sf, node.getStart());
      const endLine = lineOf(sf, node.getEnd());
      const lineCount = endLine - startLine + 1;

      if (lineCount >= threshold) {
        results.push({
          file: filePath,
          line: startLine,
          endLine,
          lineCount,
          symbolName: inferSymbolName(node),
          nodeType: ts.isObjectLiteralExpression(node) ? "object" : "array",
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return results;
}
