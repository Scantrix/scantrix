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

export interface DataMutationResult {
  file: string;
  line: number;
  bindingName: string;
  importPath: string;
  mutationCount: number;
  snippet: string;
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
 * Detect `browser.newContext()` calls inside test() callbacks.
 * Fixtures handle lifecycle automatically (including failure scenarios).
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

    // Count browser.newContext() calls in the callback body
    let newContextCount = 0;
    let firstLine = 0;
    function walkBody(n: ts.Node): void {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.text === "newContext" &&
        ts.isIdentifier(n.expression.expression) &&
        n.expression.expression.text === "browser"
      ) {
        newContextCount++;
        if (firstLine === 0) {
          firstLine = lineOf(sf, n.getStart());
        }
      }
      ts.forEachChild(n, walkBody);
    }
    walkBody(callback.body);

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
